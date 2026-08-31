use crate::config::{AppConfig, McpServerConfig, McpServerTransport};
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::time::Duration;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

const MAX_SERVER_NAME_BYTES: usize = 64;
const MAX_COMMAND_BYTES: usize = 4_096;
const MAX_ARGUMENTS: usize = 128;
const MAX_ARGUMENT_BYTES: usize = 8_192;
const MAX_MAP_ENTRIES: usize = 128;
const MAX_MCP_SERVERS: usize = 64;
const MAX_CONCURRENT_VALIDATIONS: usize = 4;
const MAX_VALUE_BYTES: usize = 65_536;
const MAX_URL_BYTES: usize = 8_192;
const MAX_TOOL_PAGES: usize = 32;
const MAX_TOOLS: usize = 2_048;
const MAX_AGENT_TOOL_ARGUMENT_BYTES: usize = 1024 * 1024;
const MAX_STDIO_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REMOTE_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const VALIDATION_TIMEOUT: Duration = Duration::from_secs(10);
const AGENT_TOOL_TIMEOUT: Duration = Duration::from_secs(15);
const AGENT_TOOL_CALL_ID: u64 = 65_535;
const MODERN_STDIO_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const AGENT_APPROVAL_TTL: Duration = Duration::from_secs(30);
const MAX_AGENT_APPROVALS: usize = 256;
const MAX_SAFE_JAVASCRIPT_INTEGER: u64 = 9_007_199_254_740_991;
const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";
const LEGACY_PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INHERITED_ENVIRONMENT: &[&str] = &[
    "APPDATA",
    "ComSpec",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "ProgramData",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "USERPROFILE",
    "WINDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
];
const PROTECTED_HEADERS: &[&str] = &[
    "accept",
    "connection",
    "content-length",
    "content-type",
    "host",
    "mcp-method",
    "mcp-name",
    "mcp-protocol-version",
    "mcp-session-id",
    "transfer-encoding",
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum McpConnectionError {
    CommandNotFound {
        command: String,
    },
    StartFailed {
        command: String,
        detail: String,
    },
    ConnectionRefused,
    Timeout,
    ToolTimeout,
    Remote {
        detail: String,
    },
    RemoteStatus {
        status: u16,
        method: String,
        response: Option<serde_json::Value>,
    },
    ModernProtocol {
        detail: String,
    },
    Protocol {
        detail: String,
    },
}

impl std::fmt::Display for McpConnectionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CommandNotFound { command } => {
                write!(formatter, "Could not start '{command}': command not found.")
            }
            Self::StartFailed { command, detail } => {
                write!(formatter, "Could not start '{command}': {detail}.")
            }
            Self::ConnectionRefused => formatter
                .write_str("Could not connect to the remote MCP server: connection refused."),
            Self::Timeout => formatter.write_str("MCP validation timed out after 10 seconds."),
            Self::ToolTimeout => formatter.write_str("MCP tool call timed out after 15 seconds."),
            Self::Remote { detail } => {
                write!(
                    formatter,
                    "Could not connect to the remote MCP server: {detail}."
                )
            }
            Self::RemoteStatus { status, method, .. } => write!(
                formatter,
                "Could not connect to the remote MCP server: the server returned HTTP {status} during {method}."
            ),
            Self::ModernProtocol { detail } => {
                write!(formatter, "MCP protocol error: {detail}.")
            }
            Self::Protocol { detail } => write!(formatter, "MCP protocol error: {detail}."),
        }
    }
}

trait McpClientTransport {
    fn send<'a>(
        &'a mut self,
        message: serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>> + Send + 'a>,
    >;

    fn set_protocol_version(&mut self, _version: Option<&str>) -> Result<(), McpConnectionError> {
        Ok(())
    }

    fn uses_modern_http_headers(&self) -> bool {
        false
    }

    fn send_with_headers<'a>(
        &'a mut self,
        message: serde_json::Value,
        _headers: std::collections::BTreeMap<String, String>,
    ) -> Pin<
        Box<dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>> + Send + 'a>,
    > {
        self.send(message)
    }
}

struct StdioTransport {
    child: tokio::process::Child,
    stdin: Option<tokio::process::ChildStdin>,
    stdout: BufReader<tokio::process::ChildStdout>,
    stderr: Option<tokio::task::JoinHandle<()>>,
    stderr_output: std::sync::Arc<tokio::sync::Mutex<Vec<u8>>>,
    pid: u32,
    containment: Option<crate::proc::ProcessTreeGuard>,
}

impl StdioTransport {
    async fn spawn(
        command: &str,
        args: &[String],
        environment: &std::collections::BTreeMap<String, String>,
    ) -> Result<Self, McpConnectionError> {
        use crate::proc::NoConsole;

        let mut process = tokio::process::Command::new(command);
        process
            .no_console()
            .args(args)
            .env_clear()
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for key in INHERITED_ENVIRONMENT {
            if let Some(value) = std::env::var_os(key) {
                process.env(key, value);
            }
        }
        process.envs(environment);
        crate::proc::isolate_process_tree(&mut process);
        let mut child = process.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                McpConnectionError::CommandNotFound {
                    command: command.to_string(),
                }
            } else {
                McpConnectionError::StartFailed {
                    command: command.to_string(),
                    detail: error.to_string(),
                }
            }
        })?;
        let pid = child.id().ok_or_else(|| McpConnectionError::StartFailed {
            command: command.to_string(),
            detail: "the process did not report an id".into(),
        })?;
        let containment = crate::proc::contain_process_tree(pid).map_err(|error| {
            let _ = child.start_kill();
            McpConnectionError::StartFailed {
                command: command.to_string(),
                detail: format!("the process could not be contained: {error}"),
            }
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| protocol_error("server stdin is unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| protocol_error("server stdout is unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| protocol_error("server stderr is unavailable"))?;
        let stderr_output = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let retained_output = std::sync::Arc::clone(&stderr_output);
        let stderr = tokio::spawn(async move {
            let mut stderr = stderr;
            let mut chunk = [0_u8; 8_192];
            loop {
                let read = match stderr.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(read) => read,
                };
                let mut output = retained_output.lock().await;
                let keep = MAX_STDERR_BYTES;
                if read >= keep {
                    output.clear();
                    output.extend_from_slice(&chunk[read - keep..read]);
                } else {
                    let overflow = output.len().saturating_add(read).saturating_sub(keep);
                    if overflow > 0 {
                        output.drain(..overflow);
                    }
                    output.extend_from_slice(&chunk[..read]);
                }
            }
        });
        Ok(Self {
            child,
            stdin: Some(stdin),
            stdout: BufReader::new(stdout),
            stderr: Some(stderr),
            stderr_output,
            pid,
            containment: Some(containment),
        })
    }

    async fn shutdown(mut self) {
        self.stdin.take();
        let exited = tokio::time::timeout(Duration::from_millis(500), self.child.wait()).await;
        if !matches!(exited, Ok(Ok(_))) {
            crate::proc::terminate_process_tree(self.pid).await;
            let _ = self.child.kill().await;
            let _ = self.child.wait().await;
        }
        self.containment.take();
        if let Some(stderr) = self.stderr.take() {
            let _ = tokio::time::timeout(Duration::from_millis(500), stderr).await;
        }
    }

    async fn read_response(
        &mut self,
        expected_id: u64,
    ) -> Result<serde_json::Value, McpConnectionError> {
        loop {
            let mut line = Vec::new();
            loop {
                let (consumed, complete, closed) = {
                    let available = self.stdout.fill_buf().await.map_err(|error| {
                        protocol_error(&format!("could not read server output: {error}"))
                    })?;
                    if available.is_empty() {
                        (0, false, true)
                    } else {
                        let newline = available.iter().position(|byte| *byte == b'\n');
                        let consumed = newline.map_or(available.len(), |position| position + 1);
                        if line.len().saturating_add(consumed) > MAX_STDIO_MESSAGE_BYTES {
                            return Err(protocol_error("server response exceeded the 2 MiB limit"));
                        }
                        line.extend_from_slice(&available[..consumed]);
                        (consumed, newline.is_some(), false)
                    }
                };
                if closed {
                    return Err(self.closed_output_error().await);
                }
                self.stdout.consume(consumed);
                if complete {
                    break;
                }
            }
            let message: serde_json::Value = serde_json::from_slice(&line)
                .map_err(|_| protocol_error("server wrote invalid JSON to stdout"))?;
            match message.get("id") {
                Some(id) if id == &serde_json::json!(expected_id) => return Ok(message),
                Some(_) => {
                    return Err(protocol_error(
                        "server returned a response with the wrong id",
                    ));
                }
                None => {}
            }
        }
    }

    async fn closed_output_error(&mut self) -> McpConnectionError {
        if let Some(stderr) = self.stderr.take() {
            let _ = tokio::time::timeout(Duration::from_millis(250), stderr).await;
        }
        let output = self.stderr_output.lock().await;
        let text = String::from_utf8_lossy(&output);
        let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            return protocol_error("server closed its output before replying");
        }
        protocol_error(&format!(
            "server closed its output before replying: {normalized}"
        ))
    }
}

impl McpClientTransport for StdioTransport {
    fn send<'a>(
        &'a mut self,
        message: serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>> + Send + 'a>,
    > {
        Box::pin(async move {
            let id = message.get("id").and_then(serde_json::Value::as_u64);
            let mut encoded = serde_json::to_vec(&message)
                .map_err(|_| protocol_error("client request could not be encoded"))?;
            encoded.push(b'\n');
            self.stdin
                .as_mut()
                .ok_or_else(|| protocol_error("server stdin is unavailable"))?
                .write_all(&encoded)
                .await
                .map_err(|error| protocol_error(&format!("could not write to server: {error}")))?;
            self.stdin
                .as_mut()
                .ok_or_else(|| protocol_error("server stdin is unavailable"))?
                .flush()
                .await
                .map_err(|error| {
                    protocol_error(&format!("could not flush server input: {error}"))
                })?;
            match id {
                Some(id) => self.read_response(id).await.map(Some),
                None => Ok(None),
            }
        })
    }
}

struct RemoteTransport {
    client: reqwest::Client,
    url: reqwest::Url,
    headers: reqwest::header::HeaderMap,
    session_id: Option<reqwest::header::HeaderValue>,
    protocol_version: Option<reqwest::header::HeaderValue>,
    timeout_error: McpConnectionError,
}

impl RemoteTransport {
    fn new(
        url: &str,
        headers: &std::collections::BTreeMap<String, String>,
    ) -> Result<Self, McpConnectionError> {
        Self::new_with_timeout(
            url,
            headers,
            VALIDATION_TIMEOUT,
            McpConnectionError::Timeout,
        )
    }

    fn new_for_tool_call(
        url: &str,
        headers: &std::collections::BTreeMap<String, String>,
    ) -> Result<Self, McpConnectionError> {
        Self::new_with_timeout(
            url,
            headers,
            AGENT_TOOL_TIMEOUT,
            McpConnectionError::ToolTimeout,
        )
    }

    fn new_with_timeout(
        url: &str,
        headers: &std::collections::BTreeMap<String, String>,
        timeout: Duration,
        timeout_error: McpConnectionError,
    ) -> Result<Self, McpConnectionError> {
        let url =
            reqwest::Url::parse(url).map_err(|_| protocol_error("remote server URL is invalid"))?;
        let mut request_headers = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            let key = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|_| protocol_error(&format!("header name '{key}' is invalid")))?;
            let value = reqwest::header::HeaderValue::from_str(value)
                .map_err(|_| protocol_error("a configured header value is invalid"))?;
            request_headers.insert(key, value);
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(timeout)
            .build()
            .map_err(|_| protocol_error("remote HTTP client could not be created"))?;
        Ok(Self {
            client,
            url,
            headers: request_headers,
            session_id: None,
            protocol_version: None,
            timeout_error,
        })
    }

    async fn send_request(
        &mut self,
        message: serde_json::Value,
        additional_headers: std::collections::BTreeMap<String, String>,
    ) -> Result<Option<serde_json::Value>, McpConnectionError> {
        let expected_id = message.get("id").and_then(serde_json::Value::as_u64);
        let method = message
            .get("method")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("request")
            .to_string();
        let mut request = self
            .client
            .post(self.url.clone())
            .headers(self.headers.clone())
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            );
        let negotiated_version = self
            .protocol_version
            .as_ref()
            .and_then(|value| value.to_str().ok());
        let modern = negotiated_version == Some(MODERN_PROTOCOL_VERSION);
        if let Some(session_id) = &self.session_id {
            request = request.header("Mcp-Session-Id", session_id.clone());
        }
        if let Some(protocol_version) = &self.protocol_version {
            if negotiated_version.is_some_and(|version| version >= "2025-06-18") {
                request = request.header("MCP-Protocol-Version", protocol_version.clone());
            }
        }
        if modern {
            request = request.header("Mcp-Method", method.clone());
            if let Some(name) = modern_request_name(&message, &method)? {
                request = request.header("Mcp-Name", encode_modern_header_value(name)?);
            }
            for (name, value) in additional_headers {
                if !name.to_ascii_lowercase().starts_with("mcp-param-") {
                    return Err(protocol_error("an internal MCP request header was invalid"));
                }
                let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| protocol_error("an MCP parameter header name was invalid"))?;
                let value = reqwest::header::HeaderValue::from_str(&value)
                    .map_err(|_| protocol_error("an MCP parameter header value was invalid"))?;
                request = request.header(name, value);
            }
        }
        let response = request
            .json(&message)
            .send()
            .await
            .map_err(|error| classify_remote_error(error, &self.timeout_error))?;
        let status = response.status();
        if response.status().is_redirection() {
            return Err(McpConnectionError::Remote {
                detail: "the server redirected the request; enter its final MCP URL".into(),
            });
        }
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let mut body = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|error| classify_remote_error(error, &self.timeout_error))?;
                if body.len().saturating_add(chunk.len()) > MAX_REMOTE_RESPONSE_BYTES {
                    return Err(protocol_error("server response exceeded the 2 MiB limit"));
                }
                body.extend_from_slice(&chunk);
            }
            return Err(McpConnectionError::RemoteStatus {
                status,
                method,
                response: serde_json::from_slice(&body).ok(),
            });
        }
        if expected_id.is_none() && status != reqwest::StatusCode::ACCEPTED {
            return Err(protocol_error(&format!(
                "{method} returned HTTP {} instead of 202 Accepted",
                status.as_u16()
            )));
        }
        if !modern && self.session_id.is_none() {
            self.session_id = response.headers().get("mcp-session-id").cloned();
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim);
        let is_sse =
            content_type.is_some_and(|value| value.eq_ignore_ascii_case("text/event-stream"));
        let is_json =
            content_type.is_some_and(|value| value.eq_ignore_ascii_case("application/json"));
        if expected_id.is_some() && !is_sse && !is_json {
            let received = content_type.unwrap_or("no Content-Type");
            return Err(protocol_error(&format!(
                "{method} returned unsupported content type '{received}'"
            )));
        }
        let mut body = Vec::new();
        let mut sse = SseDecoder::default();
        let mut received = 0_usize;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| classify_remote_error(error, &self.timeout_error))?;
            received = received.saturating_add(chunk.len());
            if received > MAX_REMOTE_RESPONSE_BYTES {
                return Err(protocol_error("server response exceeded the 2 MiB limit"));
            }
            if is_sse {
                if let Some(expected_id) = expected_id {
                    if let Some(response) = sse.push(&chunk, expected_id)? {
                        return Ok(Some(response));
                    }
                } else {
                    body.extend_from_slice(&chunk);
                }
            } else {
                body.extend_from_slice(&chunk);
            }
        }
        let Some(expected_id) = expected_id else {
            if body.is_empty() {
                return Ok(None);
            }
            let response = serde_json::from_slice(&body)
                .map_err(|_| protocol_error("server returned invalid JSON"))?;
            return Ok(Some(response));
        };
        if is_sse {
            return sse.finish(expected_id).map(Some);
        }
        let response = serde_json::from_slice(&body)
            .map_err(|_| protocol_error("server returned invalid JSON"))?;
        Ok(Some(response))
    }

    async fn shutdown(&mut self) {
        let Some(session_id) = self.session_id.take() else {
            return;
        };
        let mut request = self
            .client
            .delete(self.url.clone())
            .headers(self.headers.clone())
            .header("Mcp-Session-Id", session_id);
        if let Some(protocol_version) = &self.protocol_version {
            if protocol_version
                .to_str()
                .ok()
                .is_some_and(|version| version >= "2025-06-18")
            {
                request = request.header("MCP-Protocol-Version", protocol_version.clone());
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(1), request.send()).await;
    }
}

impl McpClientTransport for RemoteTransport {
    fn send<'a>(
        &'a mut self,
        message: serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>> + Send + 'a>,
    > {
        Box::pin(self.send_request(message, std::collections::BTreeMap::new()))
    }

    fn set_protocol_version(&mut self, version: Option<&str>) -> Result<(), McpConnectionError> {
        self.protocol_version = version
            .map(reqwest::header::HeaderValue::from_str)
            .transpose()
            .map_err(|_| protocol_error("server returned an invalid protocol version"))?;
        if version.is_none() {
            self.session_id = None;
        }
        Ok(())
    }

    fn uses_modern_http_headers(&self) -> bool {
        true
    }

    fn send_with_headers<'a>(
        &'a mut self,
        message: serde_json::Value,
        headers: std::collections::BTreeMap<String, String>,
    ) -> Pin<
        Box<dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>> + Send + 'a>,
    > {
        Box::pin(self.send_request(message, headers))
    }
}

fn classify_remote_error(
    error: reqwest::Error,
    timeout_error: &McpConnectionError,
) -> McpConnectionError {
    if error.is_timeout() {
        return timeout_error.clone();
    }
    if error_chain_contains_connection_refused(&error) {
        return McpConnectionError::ConnectionRefused;
    }
    let detail = if error.is_connect() {
        "connection failed"
    } else if error.is_decode() {
        "the server returned an unreadable response"
    } else {
        "the request failed"
    };
    McpConnectionError::Remote {
        detail: detail.into(),
    }
}

fn error_chain_contains_connection_refused(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(error) = current {
        if error
            .downcast_ref::<std::io::Error>()
            .is_some_and(|error| error.kind() == std::io::ErrorKind::ConnectionRefused)
        {
            return true;
        }
        current = error.source();
    }
    false
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct McpServerTool {
    pub name: String,
    pub description: Option<String>,
    #[serde(skip_serializing)]
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct McpAgentTool {
    pub name: String,
    pub tool_handle: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct McpAgentServer {
    pub name: String,
    pub tools: Vec<McpAgentTool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct McpAgentApprovalPolicy {
    mode: crate::approvals::ApprovalMode,
    decision: Option<crate::approvals::ToolDecision>,
}

struct McpAgentApproval {
    project_id: String,
    server: McpServerConfig,
    tool_handle: String,
    argument_digest: [u8; 32],
    run_id: String,
    run_generation: u64,
    policy: McpAgentApprovalPolicy,
    expires_at: std::time::Instant,
}

#[derive(Default)]
struct McpAgentApprovalRegistry {
    approvals: HashMap<String, McpAgentApproval>,
    order: VecDeque<String>,
}

struct McpAgentApprovalBinding<'a> {
    project_id: &'a str,
    server: &'a McpServerConfig,
    tool_handle: &'a str,
    argument_digest: [u8; 32],
    run_id: &'a str,
    run_generation: u64,
    policy: McpAgentApprovalPolicy,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpServerValidationStatus {
    Connected,
    Error,
    Disabled,
    Checking,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct McpServerValidation {
    pub name: String,
    pub status: McpServerValidationStatus,
    pub tool_count: usize,
    pub tools: Vec<McpServerTool>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct McpManagedServer {
    pub config: McpServerConfig,
    pub validation: McpServerValidation,
}

trait McpConfigRepository {
    fn load(&self) -> Result<AppConfig, String>;
    fn update<F>(&self, update: F) -> Result<(), String>
    where
        F: FnOnce(&mut AppConfig) -> Result<(), String>;
}

struct AppConfigRepository;

impl McpConfigRepository for AppConfigRepository {
    fn load(&self) -> Result<AppConfig, String> {
        crate::config::read_config()
    }

    fn update<F>(&self, update: F) -> Result<(), String>
    where
        F: FnOnce(&mut AppConfig) -> Result<(), String>,
    {
        crate::config::update_config(update)
    }
}

async fn validate_with<F, Fut>(server: &McpServerConfig, connect: F) -> McpServerValidation
where
    F: FnOnce(McpServerConfig) -> Fut,
    Fut: Future<Output = Result<Vec<McpServerTool>, McpConnectionError>>,
{
    match connect(server.clone()).await {
        Ok(tools) => {
            let tool_count = tools.len();
            McpServerValidation {
                name: server.name.clone(),
                status: McpServerValidationStatus::Connected,
                tool_count,
                tools: redact_server_tool_metadata(server, tools),
                error: None,
            }
        }
        Err(error) => McpServerValidation {
            name: server.name.clone(),
            status: McpServerValidationStatus::Error,
            tool_count: 0,
            tools: Vec::new(),
            error: Some(redact_server_values(server, error.to_string())),
        },
    }
}

fn redact_server_values(server: &McpServerConfig, message: String) -> String {
    match server_value_matcher(server) {
        Ok(matcher) => redact_with_matcher(&message, matcher.as_ref()),
        Err(()) => "MCP validation failed without showing server details.".into(),
    }
}

fn redact_server_tool_metadata(
    server: &McpServerConfig,
    tools: Vec<McpServerTool>,
) -> Vec<McpServerTool> {
    let matcher = match server_value_matcher(server) {
        Ok(matcher) => matcher,
        Err(()) => {
            return tools
                .into_iter()
                .map(|_| McpServerTool {
                    name: "[tool metadata hidden]".into(),
                    description: None,
                    input_schema: serde_json::json!({"type": "object"}),
                })
                .collect();
        }
    };
    tools
        .into_iter()
        .map(|tool| McpServerTool {
            name: redact_with_matcher(&tool.name, matcher.as_ref()),
            description: tool
                .description
                .map(|description| redact_with_matcher(&description, matcher.as_ref())),
            input_schema: tool.input_schema,
        })
        .collect()
}

fn server_value_matcher(server: &McpServerConfig) -> Result<Option<aho_corasick::AhoCorasick>, ()> {
    let mut values = match &server.transport {
        McpServerTransport::Stdio { env, .. } => env.values().collect::<Vec<_>>(),
        McpServerTransport::Remote { headers, .. } => headers.values().collect::<Vec<_>>(),
    };
    values.retain(|value| !value.is_empty());
    values.sort_unstable();
    values.dedup();
    if values.is_empty() {
        return Ok(None);
    }
    aho_corasick::AhoCorasickBuilder::new()
        .match_kind(aho_corasick::MatchKind::LeftmostLongest)
        .build(&values)
        .map(Some)
        .map_err(|_| ())
}

fn replace_server_values(message: &str, matcher: Option<&aho_corasick::AhoCorasick>) -> String {
    let Some(matcher) = matcher else {
        return message.to_string();
    };
    let mut redacted = String::with_capacity(message.len());
    let mut copied = 0;
    for matched in matcher.find_iter(message) {
        redacted.push_str(&message[copied..matched.start()]);
        redacted.push_str("[stored value]");
        copied = matched.end();
    }
    redacted.push_str(&message[copied..]);
    redacted
}

fn redact_with_matcher(message: &str, matcher: Option<&aho_corasick::AhoCorasick>) -> String {
    bounded_message(&replace_server_values(message, matcher))
}

fn redact_json_value(
    value: serde_json::Value,
    matcher: Option<&aho_corasick::AhoCorasick>,
) -> serde_json::Value {
    match value {
        serde_json::Value::String(value) => {
            serde_json::Value::String(replace_server_values(&value, matcher))
        }
        serde_json::Value::Array(values) => serde_json::Value::Array(
            values
                .into_iter()
                .map(|value| redact_json_value(value, matcher))
                .collect(),
        ),
        serde_json::Value::Object(values) => serde_json::Value::Object(
            values
                .into_iter()
                .map(|(key, value)| {
                    (
                        replace_server_values(&key, matcher),
                        redact_json_value(value, matcher),
                    )
                })
                .collect(),
        ),
        value => value,
    }
}

fn strip_mcp_transport_schema_extensions(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Array(values) => serde_json::Value::Array(
            values
                .into_iter()
                .map(strip_mcp_transport_schema_extensions)
                .collect(),
        ),
        serde_json::Value::Object(values) => serde_json::Value::Object(
            values
                .into_iter()
                .filter(|(key, _)| key != "x-mcp-header")
                .map(|(key, value)| (key, strip_mcp_transport_schema_extensions(value)))
                .collect(),
        ),
        value => value,
    }
}

fn agent_identifier_part(value: &str, fallback: &str, max_len: usize) -> String {
    let mut output = String::with_capacity(max_len);
    let mut separator = false;
    for byte in value.bytes() {
        if output.len() == max_len {
            break;
        }
        if byte.is_ascii_alphanumeric() {
            output.push(char::from(byte.to_ascii_lowercase()));
            separator = false;
        } else if !output.is_empty() && !separator {
            output.push('_');
            separator = true;
        }
    }
    while output.ends_with('_') {
        output.pop();
    }
    if output.is_empty() {
        fallback.to_string()
    } else {
        output
    }
}

fn agent_tool_name(server: &str, tool: &str) -> String {
    use sha2::Digest as _;

    let server_part = agent_identifier_part(server, "server", 16);
    let tool_part = agent_identifier_part(tool, "tool", 24);
    let mut hasher = sha2::Sha256::new();
    hasher.update(server.as_bytes());
    hasher.update([0]);
    hasher.update(tool.as_bytes());
    let digest = hasher.finalize();
    let suffix = digest[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("mcp_ext_{server_part}_{tool_part}_{suffix}")
}

fn build_agent_tool_catalog(
    mut discovered: Vec<(McpServerConfig, Vec<McpServerTool>)>,
) -> Vec<McpAgentServer> {
    discovered.sort_by(|(left, _), (right, _)| left.name.cmp(&right.name));
    let mut servers = Vec::new();
    for (server, mut tools) in discovered {
        let Ok(matcher) = server_value_matcher(&server) else {
            continue;
        };
        tools.sort_by(|left, right| left.name.cmp(&right.name));
        tools.dedup_by(|left, right| left.name == right.name);
        let tools = tools
            .into_iter()
            .filter(|tool| {
                matcher
                    .as_ref()
                    .map_or(true, |matcher| !matcher.is_match(&tool.name))
            })
            .map(|tool| McpAgentTool {
                name: agent_tool_name(&server.name, &tool.name),
                tool_handle: tool.name,
                description: tool
                    .description
                    .map(|description| redact_with_matcher(&description, matcher.as_ref())),
                input_schema: strip_mcp_transport_schema_extensions(redact_json_value(
                    tool.input_schema,
                    matcher.as_ref(),
                )),
            })
            .collect::<Vec<_>>();
        if !tools.is_empty() {
            servers.push(McpAgentServer {
                name: server.name,
                tools,
            });
        }
    }
    servers
}

fn connected_validation(validation: McpServerValidation) -> Result<McpServerValidation, String> {
    if validation.status == McpServerValidationStatus::Connected {
        Ok(validation)
    } else {
        Err(validation
            .error
            .unwrap_or_else(|| "MCP server validation failed.".into()))
    }
}

fn normalize_server_config(server: McpServerConfig) -> Result<McpServerConfig, String> {
    normalize_server_config_with_stored_values(server, false)
}

fn normalize_server_config_with_stored_values(
    mut server: McpServerConfig,
    allow_stored_values: bool,
) -> Result<McpServerConfig, String> {
    server.name = normalize_server_name(&server.name)?;
    match &mut server.transport {
        McpServerTransport::Stdio { command, args, env } => {
            *command = command.trim().to_string();
            if command.is_empty() {
                return Err("Command is required.".into());
            }
            if command.len() > MAX_COMMAND_BYTES || command.chars().any(char::is_control) {
                return Err("Command is too long or contains a control character.".into());
            }
            if args.len() > MAX_ARGUMENTS {
                return Err(format!(
                    "A server can have at most {MAX_ARGUMENTS} arguments."
                ));
            }
            if args
                .iter()
                .any(|argument| argument.len() > MAX_ARGUMENT_BYTES || argument.contains('\0'))
            {
                return Err("An argument is too long or contains a null character.".into());
            }
            validate_environment(env, allow_stored_values)?;
        }
        McpServerTransport::Remote { url, headers } => {
            *url = url.trim().to_string();
            if url.is_empty() {
                return Err("Remote URL is required.".into());
            }
            if url.len() > MAX_URL_BYTES {
                return Err("Remote URL is too long.".into());
            }
            let parsed =
                reqwest::Url::parse(url).map_err(|_| "Remote URL is invalid.".to_string())?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err("Remote URL must use http or https.".into());
            }
            if parsed.scheme() == "http" && !is_loopback_url(&parsed) {
                return Err("Remote URL must use HTTPS unless it points to localhost.".into());
            }
            if !parsed.username().is_empty() || parsed.password().is_some() {
                return Err("Remote URL cannot include credentials.".into());
            }
            if parsed.fragment().is_some() {
                return Err("Remote URL cannot include a fragment.".into());
            }
            *url = parsed.to_string();
            validate_headers(headers, allow_stored_values)?;
        }
    }
    Ok(server)
}

fn is_loopback_url(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn normalize_server_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Server name is required.".into());
    }
    if name.len() > MAX_SERVER_NAME_BYTES
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err("Server name can use letters, numbers, dots, hyphens, and underscores.".into());
    }
    Ok(name.to_string())
}

fn validate_environment(
    values: &std::collections::BTreeMap<String, String>,
    allow_stored_values: bool,
) -> Result<(), String> {
    if values.len() > MAX_MAP_ENTRIES {
        return Err(format!(
            "A server can have at most {MAX_MAP_ENTRIES} environment variables."
        ));
    }
    for (key, value) in values {
        let mut bytes = key.bytes();
        let valid_key = bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
        if !valid_key {
            return Err(format!("Environment variable name '{key}' is invalid."));
        }
        if value.len() > MAX_VALUE_BYTES || value.contains('\0') {
            return Err(format!(
                "Environment variable '{key}' has an invalid value."
            ));
        }
        if crate::config::is_mcp_secret_marker(value)
            && (!allow_stored_values || value != crate::config::REDACTED)
        {
            return Err(format!(
                "Environment variable '{key}' must be entered again."
            ));
        }
    }
    Ok(())
}

fn validate_headers(
    values: &std::collections::BTreeMap<String, String>,
    allow_stored_values: bool,
) -> Result<(), String> {
    if values.len() > MAX_MAP_ENTRIES {
        return Err(format!(
            "A server can have at most {MAX_MAP_ENTRIES} headers."
        ));
    }
    for (key, value) in values {
        let normalized = key.to_ascii_lowercase();
        if PROTECTED_HEADERS.contains(&normalized.as_str()) || normalized.starts_with("mcp-param-")
        {
            return Err(format!("Header '{key}' is managed by Oleafly."));
        }
        reqwest::header::HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| format!("Header name '{key}' is invalid."))?;
        if value.len() > MAX_VALUE_BYTES {
            return Err(format!("Header '{key}' is too long."));
        }
        reqwest::header::HeaderValue::from_str(value)
            .map_err(|_| format!("Header '{key}' has an invalid value."))?;
        if crate::config::is_mcp_secret_marker(value)
            && (!allow_stored_values || value != crate::config::REDACTED)
        {
            return Err(format!("Header '{key}' must be entered again."));
        }
    }
    Ok(())
}

async fn add_server_with<R, F, Fut>(
    repository: &R,
    server: McpServerConfig,
    connect: F,
) -> Result<McpManagedServer, String>
where
    R: McpConfigRepository,
    F: FnOnce(McpServerConfig) -> Fut,
    Fut: Future<Output = Result<Vec<McpServerTool>, McpConnectionError>>,
{
    let server = normalize_server_config(server)?;
    let config = repository.load()?;
    if config
        .mcp_servers
        .iter()
        .any(|existing| existing.name == server.name)
    {
        return Err(format!(
            "An MCP server named '{}' already exists.",
            server.name
        ));
    }
    if config.mcp_servers.len() >= MAX_MCP_SERVERS {
        return Err(format!(
            "Oleafly supports up to {MAX_MCP_SERVERS} MCP servers."
        ));
    }
    let validation = connected_validation(validate_with(&server, connect).await)?;
    repository.update(|config| {
        if config
            .mcp_servers
            .iter()
            .any(|existing| existing.name == server.name)
        {
            return Err(format!(
                "An MCP server named '{}' already exists.",
                server.name
            ));
        }
        if config.mcp_servers.len() >= MAX_MCP_SERVERS {
            return Err(format!(
                "Oleafly supports up to {MAX_MCP_SERVERS} MCP servers."
            ));
        }
        config.mcp_servers.push(server.clone());
        Ok(())
    })?;
    Ok(McpManagedServer {
        config: server,
        validation,
    })
}

async fn edit_server_with<R, F, Fut>(
    repository: &R,
    current_name: &str,
    server: McpServerConfig,
    connect: F,
) -> Result<McpManagedServer, String>
where
    R: McpConfigRepository,
    F: FnOnce(McpServerConfig) -> Fut,
    Fut: Future<Output = Result<Vec<McpServerTool>, McpConnectionError>>,
{
    let mut server = normalize_server_config_with_stored_values(server, true)?;
    let config = repository.load()?;
    let expected = config
        .mcp_servers
        .iter()
        .find(|existing| existing.name == current_name)
        .cloned()
        .ok_or_else(|| format!("MCP server '{current_name}' was not found."))?;
    crate::config::restore_mcp_server_secret_markers(&mut server, &expected)?;
    let server = normalize_server_config(server)?;
    if config
        .mcp_servers
        .iter()
        .any(|existing| existing.name != current_name && existing.name == server.name)
    {
        return Err(format!(
            "An MCP server named '{}' already exists.",
            server.name
        ));
    }
    let validation = if server.enabled {
        connected_validation(validate_with(&server, connect).await)?
    } else {
        disabled_validation(&server)
    };
    repository.update(|config| {
        let index = config
            .mcp_servers
            .iter()
            .position(|existing| existing.name == current_name)
            .ok_or_else(|| format!("MCP server '{current_name}' was not found."))?;
        if config.mcp_servers[index] != expected {
            return Err(format!(
                "MCP server '{current_name}' changed before this update was saved. Review its latest settings and try again."
            ));
        }
        if config
            .mcp_servers
            .iter()
            .enumerate()
            .any(|(candidate, existing)| candidate != index && existing.name == server.name)
        {
            return Err(format!(
                "An MCP server named '{}' already exists.",
                server.name
            ));
        }
        config.mcp_servers[index] = server.clone();
        Ok(())
    })?;
    Ok(McpManagedServer {
        config: server,
        validation,
    })
}

async fn set_server_enabled_with<R, F, Fut>(
    repository: &R,
    name: &str,
    enabled: bool,
    connect: F,
) -> Result<McpManagedServer, String>
where
    R: McpConfigRepository,
    F: FnOnce(McpServerConfig) -> Fut,
    Fut: Future<Output = Result<Vec<McpServerTool>, McpConnectionError>>,
{
    let config = repository.load()?;
    let expected = config
        .mcp_servers
        .iter()
        .find(|server| server.name == name)
        .cloned()
        .ok_or_else(|| format!("MCP server '{name}' was not found."))?;
    let mut server = expected.clone();
    server.enabled = enabled;
    let validation = if enabled {
        server = normalize_server_config(server)?;
        connected_validation(validate_with(&server, connect).await)?
    } else {
        disabled_validation(&server)
    };
    repository.update(|config| {
        let index = config
            .mcp_servers
            .iter()
            .position(|candidate| candidate.name == name)
            .ok_or_else(|| format!("MCP server '{name}' was not found."))?;
        if config.mcp_servers[index] != expected {
            return Err(format!(
                "MCP server '{name}' changed before this update was saved. Review its latest settings and try again."
            ));
        }
        config.mcp_servers[index] = server.clone();
        Ok(())
    })?;
    Ok(McpManagedServer {
        config: server,
        validation,
    })
}

fn remove_server_with<R>(repository: &R, name: &str) -> Result<(), String>
where
    R: McpConfigRepository,
{
    repository.update(|config| {
        let before = config.mcp_servers.len();
        config.mcp_servers.retain(|server| server.name != name);
        if config.mcp_servers.len() == before {
            return Err(format!("MCP server '{name}' was not found."));
        }
        Ok(())
    })
}

fn disabled_validation(server: &McpServerConfig) -> McpServerValidation {
    McpServerValidation {
        name: server.name.clone(),
        status: McpServerValidationStatus::Disabled,
        tool_count: 0,
        tools: Vec::new(),
        error: None,
    }
}

async fn connect_server(server: McpServerConfig) -> Result<Vec<McpServerTool>, McpConnectionError> {
    match server.transport {
        McpServerTransport::Stdio { command, args, env } => tokio::time::timeout(
            VALIDATION_TIMEOUT,
            connect_stdio_server(&command, &args, &env),
        )
        .await
        .map_err(|_| McpConnectionError::Timeout)
        .and_then(std::convert::identity),
        McpServerTransport::Remote { url, headers } => {
            let mut transport = RemoteTransport::new(&url, &headers)?;
            let result =
                tokio::time::timeout(VALIDATION_TIMEOUT, connect_and_list_tools(&mut transport))
                    .await
                    .map_err(|_| McpConnectionError::Timeout)
                    .and_then(std::convert::identity);
            transport.shutdown().await;
            result
        }
    }
}

async fn connect_stdio_server(
    command: &str,
    args: &[String],
    environment: &std::collections::BTreeMap<String, String>,
) -> Result<Vec<McpServerTool>, McpConnectionError> {
    connect_stdio_server_with_probe_timeout(command, args, environment, MODERN_STDIO_PROBE_TIMEOUT)
        .await
}

async fn connect_stdio_server_with_probe_timeout(
    command: &str,
    args: &[String],
    environment: &std::collections::BTreeMap<String, String>,
    probe_timeout: Duration,
) -> Result<Vec<McpServerTool>, McpConnectionError> {
    let mut probe = StdioTransport::spawn(command, args, environment).await?;
    let discovery = tokio::time::timeout(probe_timeout, discover_server(&mut probe)).await;
    match discovery {
        Ok(Ok(true)) => {
            let result = list_tools(&mut probe, 2, true).await;
            probe.shutdown().await;
            result
        }
        Ok(Err(error @ McpConnectionError::ModernProtocol { .. })) => {
            probe.shutdown().await;
            Err(error)
        }
        Ok(Ok(false)) | Ok(Err(_)) | Err(_) => {
            probe.shutdown().await;
            let mut transport = StdioTransport::spawn(command, args, environment).await?;
            let result = connect_legacy_and_list_tools(&mut transport).await;
            transport.shutdown().await;
            result
        }
    }
}

#[cfg(test)]
async fn connect_server_and_call<F>(
    server: McpServerConfig,
    tool_handle: &str,
    arguments: serde_json::Value,
    authorize: F,
) -> Result<serde_json::Value, McpConnectionError>
where
    F: FnOnce() -> Result<(), McpConnectionError>,
{
    connect_server_and_call_until(
        server,
        tool_handle,
        arguments,
        authorize,
        tokio::time::Instant::now() + AGENT_TOOL_TIMEOUT,
    )
    .await
}

async fn connect_server_and_call_until<F>(
    server: McpServerConfig,
    tool_handle: &str,
    arguments: serde_json::Value,
    authorize: F,
    execution_deadline: tokio::time::Instant,
) -> Result<serde_json::Value, McpConnectionError>
where
    F: FnOnce() -> Result<(), McpConnectionError>,
{
    match server.transport {
        McpServerTransport::Stdio { command, args, env } => {
            connect_stdio_server_and_call_until(
                &command,
                &args,
                &env,
                tool_handle,
                arguments,
                authorize,
                MODERN_STDIO_PROBE_TIMEOUT,
                execution_deadline,
            )
            .await
        }
        McpServerTransport::Remote { url, headers } => {
            let mut transport = RemoteTransport::new_for_tool_call(&url, &headers)?;
            let result = tokio::time::timeout_at(
                execution_deadline,
                connect_and_call_tool(&mut transport, tool_handle, arguments, authorize),
            )
            .await
            .unwrap_or(Err(McpConnectionError::ToolTimeout));
            transport.shutdown().await;
            result
        }
    }
}

#[cfg(test)]
async fn connect_stdio_server_and_call_with_probe_timeout<F>(
    command: &str,
    args: &[String],
    environment: &std::collections::BTreeMap<String, String>,
    tool_handle: &str,
    arguments: serde_json::Value,
    authorize: F,
    probe_timeout: Duration,
) -> Result<serde_json::Value, McpConnectionError>
where
    F: FnOnce() -> Result<(), McpConnectionError>,
{
    connect_stdio_server_and_call_until(
        command,
        args,
        environment,
        tool_handle,
        arguments,
        authorize,
        probe_timeout,
        tokio::time::Instant::now() + AGENT_TOOL_TIMEOUT,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn connect_stdio_server_and_call_until<F>(
    command: &str,
    args: &[String],
    environment: &std::collections::BTreeMap<String, String>,
    tool_handle: &str,
    arguments: serde_json::Value,
    authorize: F,
    probe_timeout: Duration,
    execution_deadline: tokio::time::Instant,
) -> Result<serde_json::Value, McpConnectionError>
where
    F: FnOnce() -> Result<(), McpConnectionError>,
{
    let mut probe = StdioTransport::spawn(command, args, environment).await?;
    probe.set_protocol_version(Some(MODERN_PROTOCOL_VERSION))?;
    let probe_deadline = std::cmp::min(
        execution_deadline,
        tokio::time::Instant::now() + probe_timeout,
    );
    let discovery = tokio::time::timeout_at(probe_deadline, discover_server(&mut probe)).await;
    match discovery {
        Ok(Ok(true)) => {
            let result = tokio::time::timeout_at(
                execution_deadline,
                list_authorize_and_call(&mut probe, 2, true, tool_handle, arguments, authorize),
            )
            .await
            .unwrap_or(Err(McpConnectionError::ToolTimeout));
            probe.shutdown().await;
            result
        }
        Ok(Err(error @ McpConnectionError::ModernProtocol { .. })) => {
            probe.shutdown().await;
            Err(error)
        }
        Ok(Ok(false)) | Ok(Err(_)) | Err(_) => {
            probe.shutdown().await;
            if tokio::time::Instant::now() >= execution_deadline {
                return Err(McpConnectionError::ToolTimeout);
            }
            let mut transport = StdioTransport::spawn(command, args, environment).await?;
            let result = tokio::time::timeout_at(execution_deadline, async {
                initialize_legacy(&mut transport).await?;
                list_authorize_and_call(&mut transport, 3, false, tool_handle, arguments, authorize)
                    .await
            })
            .await
            .unwrap_or(Err(McpConnectionError::ToolTimeout));
            transport.shutdown().await;
            result
        }
    }
}

async fn connect_and_list_tools<T>(
    transport: &mut T,
) -> Result<Vec<McpServerTool>, McpConnectionError>
where
    T: McpClientTransport,
{
    transport.set_protocol_version(Some(MODERN_PROTOCOL_VERSION))?;
    let modern = discover_server(transport).await?;
    if modern {
        return list_tools(transport, 2, true).await;
    }
    transport.set_protocol_version(None)?;
    connect_legacy_and_list_tools(transport).await
}

async fn connect_legacy_and_list_tools<T>(
    transport: &mut T,
) -> Result<Vec<McpServerTool>, McpConnectionError>
where
    T: McpClientTransport,
{
    initialize_legacy(transport).await?;
    list_tools(transport, 3, false).await
}

async fn initialize_legacy<T>(transport: &mut T) -> Result<(), McpConnectionError>
where
    T: McpClientTransport,
{
    let initialize = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "initialize",
        "params": {
            "protocolVersion": crate::mcp::protocol::PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "oleafly", "version": env!("CARGO_PKG_VERSION")}
        }
    });
    let response = required_response(transport.send(initialize).await?, "initialize")?;
    let result = rpc_result(&response, 2, "initialize")?;
    let protocol_version = result
        .get("protocolVersion")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| protocol_error("initialize returned no protocol version"))?;
    if !LEGACY_PROTOCOL_VERSIONS.contains(&protocol_version) {
        return Err(protocol_error(&format!(
            "initialize returned unsupported protocol version '{protocol_version}'"
        )));
    }
    transport.set_protocol_version(Some(protocol_version))?;
    let initialized = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    if transport.send(initialized).await?.is_some() {
        return Err(protocol_error(
            "notifications/initialized returned an unexpected response",
        ));
    }
    Ok(())
}

async fn connect_and_call_tool<T, F>(
    transport: &mut T,
    tool_handle: &str,
    arguments: serde_json::Value,
    authorize: F,
) -> Result<serde_json::Value, McpConnectionError>
where
    T: McpClientTransport,
    F: FnOnce() -> Result<(), McpConnectionError>,
{
    transport.set_protocol_version(Some(MODERN_PROTOCOL_VERSION))?;
    if discover_server(transport).await? {
        return list_authorize_and_call(transport, 2, true, tool_handle, arguments, authorize)
            .await;
    }
    transport.set_protocol_version(None)?;
    initialize_legacy(transport).await?;
    list_authorize_and_call(transport, 3, false, tool_handle, arguments, authorize).await
}

async fn list_authorize_and_call<T, F>(
    transport: &mut T,
    first_id: u64,
    modern: bool,
    tool_handle: &str,
    arguments: serde_json::Value,
    authorize: F,
) -> Result<serde_json::Value, McpConnectionError>
where
    T: McpClientTransport,
    F: FnOnce() -> Result<(), McpConnectionError>,
{
    let tools = list_tools(transport, first_id, modern).await?;
    let Some(tool) = tools.iter().find(|tool| tool.name == tool_handle) else {
        return Err(protocol_error(&format!(
            "tool '{tool_handle}' is no longer available from the configured server"
        )));
    };
    let headers = if modern && transport.uses_modern_http_headers() {
        mirrored_tool_headers(&tool.input_schema, &arguments)?
    } else {
        std::collections::BTreeMap::new()
    };
    authorize()?;
    call_tool(transport, tool_handle, arguments, modern, headers).await
}

async fn call_tool<T>(
    transport: &mut T,
    tool_handle: &str,
    arguments: serde_json::Value,
    modern: bool,
    headers: std::collections::BTreeMap<String, String>,
) -> Result<serde_json::Value, McpConnectionError>
where
    T: McpClientTransport,
{
    let mut params = serde_json::json!({
        "name": tool_handle,
        "arguments": arguments
    });
    if modern {
        params["_meta"] = modern_request_metadata();
    }
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": AGENT_TOOL_CALL_ID,
        "method": "tools/call",
        "params": params
    });
    let response = required_response(
        transport.send_with_headers(request, headers).await?,
        "tools/call",
    )?;
    let result = rpc_result(&response, AGENT_TOOL_CALL_ID, "tools/call")?;
    if modern && result.get("resultType").and_then(serde_json::Value::as_str) != Some("complete") {
        let detail = match result.get("resultType").and_then(serde_json::Value::as_str) {
            Some("input_required") => "tools/call requested unsupported multi-round-trip input",
            Some(_) => "tools/call returned an unsupported result type",
            None => "tools/call returned no result type",
        };
        return Err(protocol_error(detail));
    }
    Ok(result.clone())
}

async fn discover_server<T>(transport: &mut T) -> Result<bool, McpConnectionError>
where
    T: McpClientTransport,
{
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "server/discover",
        "params": {"_meta": modern_request_metadata()}
    });
    let response = match transport.send(request).await {
        Ok(Some(response)) => response,
        Ok(None) => return Ok(false),
        Err(McpConnectionError::RemoteStatus {
            status,
            method,
            response,
        }) => {
            if let Some(error) = response
                .as_ref()
                .and_then(|response| recognized_modern_error(response, 1))
            {
                return Err(error);
            }
            if [400, 404, 405].contains(&status) {
                return Ok(false);
            }
            return Err(McpConnectionError::RemoteStatus {
                status,
                method,
                response,
            });
        }
        Err(error) => return Err(error),
    };
    if let Some(error) = response.get("error") {
        if let Some(error) = recognized_modern_error(&response, 1) {
            return Err(error);
        }
        if error.is_object() {
            return Ok(false);
        }
    }
    let result = rpc_result(&response, 1, "server/discover").map_err(|error| match error {
        McpConnectionError::Protocol { detail } => McpConnectionError::ModernProtocol { detail },
        error => error,
    })?;
    if result.get("resultType").and_then(serde_json::Value::as_str) != Some("complete") {
        return Err(modern_protocol_error(
            "server/discover returned an incomplete result",
        ));
    }
    let versions = result
        .get("supportedVersions")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| modern_protocol_error("server/discover returned no supported versions"))?;
    let versions = versions
        .iter()
        .map(|version| {
            version.as_str().ok_or_else(|| {
                modern_protocol_error("server/discover returned an invalid protocol version")
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !versions.contains(&MODERN_PROTOCOL_VERSION) {
        return Err(modern_protocol_error(&format!(
            "server supports protocol versions {}, not {MODERN_PROTOCOL_VERSION}",
            versions.join(", ")
        )));
    }
    Ok(true)
}

fn modern_request_metadata() -> serde_json::Value {
    serde_json::json!({
        "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
            "name": "oleafly",
            "version": env!("CARGO_PKG_VERSION")
        },
        "io.modelcontextprotocol/clientCapabilities": {}
    })
}

fn modern_request_name<'a>(
    message: &'a serde_json::Value,
    method: &str,
) -> Result<Option<&'a str>, McpConnectionError> {
    let field = match method {
        "tools/call" | "prompts/get" => Some("name"),
        "resources/read" => Some("uri"),
        _ => None,
    };
    let Some(field) = field else {
        return Ok(None);
    };
    message
        .pointer(&format!("/params/{field}"))
        .and_then(serde_json::Value::as_str)
        .map(Some)
        .ok_or_else(|| protocol_error(&format!("{method} request has no {field}")))
}

fn encode_modern_header_value(value: &str) -> Result<String, McpConnectionError> {
    use base64::Engine as _;

    let bytes = value.as_bytes();
    let sentinel = value.starts_with("=?base64?") && value.ends_with("?=");
    let safe = bytes
        .iter()
        .all(|byte| *byte == b'\t' || (0x20..=0x7e).contains(byte))
        && !bytes
            .first()
            .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
        && !bytes
            .last()
            .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
        && !sentinel;
    let encoded = if safe {
        value.to_string()
    } else {
        format!(
            "=?base64?{}?=",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    };
    if encoded.len() > MAX_VALUE_BYTES {
        return Err(protocol_error(
            "an MCP mirrored header value exceeded the 64 KiB limit",
        ));
    }
    Ok(encoded)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum McpHeaderParameterType {
    String,
    Integer,
    Boolean,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct McpHeaderBinding {
    name: String,
    path: Vec<String>,
    parameter_type: McpHeaderParameterType,
}

fn mcp_header_bindings(
    schema: &serde_json::Value,
) -> Result<Vec<McpHeaderBinding>, McpConnectionError> {
    let mut bindings = Vec::new();
    let mut names = std::collections::HashSet::new();
    scan_mcp_header_bindings(
        schema,
        true,
        false,
        &mut Vec::new(),
        &mut names,
        &mut bindings,
    )?;
    Ok(bindings)
}

fn scan_mcp_header_bindings(
    schema: &serde_json::Value,
    property_chain: bool,
    annotatable: bool,
    path: &mut Vec<String>,
    names: &mut std::collections::HashSet<String>,
    bindings: &mut Vec<McpHeaderBinding>,
) -> Result<(), McpConnectionError> {
    if let Some(values) = schema.as_array() {
        for value in values {
            scan_mcp_header_bindings(value, false, false, path, names, bindings)?;
        }
        return Ok(());
    }
    let Some(object) = schema.as_object() else {
        return Ok(());
    };
    if let Some(annotation) = object.get("x-mcp-header") {
        if !property_chain || !annotatable {
            return Err(protocol_error(
                "x-mcp-header appeared outside a statically reachable property",
            ));
        }
        let name = annotation
            .as_str()
            .filter(|name| !name.is_empty() && name.bytes().all(is_http_token_byte))
            .ok_or_else(|| protocol_error("x-mcp-header contained an invalid header name"))?;
        let normalized = name.to_ascii_lowercase();
        if !names.insert(normalized) {
            return Err(protocol_error(
                "x-mcp-header names were not case-insensitively unique",
            ));
        }
        let parameter_type = match object.get("type").and_then(serde_json::Value::as_str) {
            Some("string") => McpHeaderParameterType::String,
            Some("integer") => McpHeaderParameterType::Integer,
            Some("boolean") => McpHeaderParameterType::Boolean,
            _ => {
                return Err(protocol_error(
                    "x-mcp-header was applied to a non-primitive parameter",
                ));
            }
        };
        bindings.push(McpHeaderBinding {
            name: name.to_string(),
            path: path.clone(),
            parameter_type,
        });
    }
    for (key, value) in object {
        if key == "x-mcp-header" {
            continue;
        }
        if property_chain && key == "properties" {
            if let Some(properties) = value.as_object() {
                for (property, property_schema) in properties {
                    path.push(property.clone());
                    scan_mcp_header_bindings(property_schema, true, true, path, names, bindings)?;
                    path.pop();
                }
                continue;
            }
        }
        scan_mcp_header_bindings(value, false, false, path, names, bindings)?;
    }
    Ok(())
}

fn is_http_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'!' | b'#'
                | b'$'
                | b'%'
                | b'&'
                | b'\''
                | b'*'
                | b'+'
                | b'-'
                | b'.'
                | b'^'
                | b'_'
                | b'`'
                | b'|'
                | b'~'
        )
}

fn mirrored_tool_headers(
    schema: &serde_json::Value,
    arguments: &serde_json::Value,
) -> Result<std::collections::BTreeMap<String, String>, McpConnectionError> {
    let mut headers = std::collections::BTreeMap::new();
    for binding in mcp_header_bindings(schema)? {
        let mut value = arguments;
        let mut missing = false;
        for segment in &binding.path {
            let Some(next) = value.as_object().and_then(|object| object.get(segment)) else {
                missing = true;
                break;
            };
            value = next;
        }
        if missing || value.is_null() {
            continue;
        }
        let value = match binding.parameter_type {
            McpHeaderParameterType::String => value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| protocol_error("an MCP mirrored string argument was invalid"))?,
            McpHeaderParameterType::Boolean => value
                .as_bool()
                .map(|value| value.to_string())
                .ok_or_else(|| protocol_error("an MCP mirrored boolean argument was invalid"))?,
            McpHeaderParameterType::Integer => safe_integer_header_value(value)?,
        };
        headers.insert(
            format!("Mcp-Param-{}", binding.name),
            encode_modern_header_value(&value)?,
        );
    }
    Ok(headers)
}

fn safe_integer_header_value(value: &serde_json::Value) -> Result<String, McpConnectionError> {
    if let Some(value) = value.as_i64() {
        if value.unsigned_abs() <= MAX_SAFE_JAVASCRIPT_INTEGER {
            return Ok(value.to_string());
        }
    } else if let Some(value) = value.as_u64() {
        if value <= MAX_SAFE_JAVASCRIPT_INTEGER {
            return Ok(value.to_string());
        }
    }
    Err(protocol_error(
        "an MCP mirrored integer argument was outside the safe integer range",
    ))
}

fn recognized_modern_error(
    response: &serde_json::Value,
    expected_id: u64,
) -> Option<McpConnectionError> {
    if response.get("jsonrpc").and_then(serde_json::Value::as_str) != Some("2.0")
        || response.get("id") != Some(&serde_json::json!(expected_id))
    {
        return None;
    }
    let error = response.get("error")?;
    let code = error.get("code")?.as_i64()?;
    if !matches!(code, -32022..=-32020) {
        return None;
    }
    if code == -32022 {
        let supported = error
            .pointer("/data/supported")
            .and_then(serde_json::Value::as_array)
            .map(|versions| {
                versions
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|versions| !versions.is_empty());
        let detail = supported.map_or_else(
            || format!("server does not support protocol version {MODERN_PROTOCOL_VERSION}"),
            |versions| {
                format!(
                    "server supports protocol versions {versions}, not {MODERN_PROTOCOL_VERSION}"
                )
            },
        );
        return Some(McpConnectionError::ModernProtocol { detail });
    }
    let message = error
        .get("message")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("the modern request was rejected");
    Some(McpConnectionError::ModernProtocol {
        detail: message.trim_end_matches('.').to_string(),
    })
}

fn bounded_message(message: &str) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut bounded = normalized.chars().take(512).collect::<String>();
    if normalized.chars().count() > 512 {
        bounded.push_str("...");
    }
    bounded
}

async fn list_tools<T>(
    transport: &mut T,
    first_id: u64,
    modern: bool,
) -> Result<Vec<McpServerTool>, McpConnectionError>
where
    T: McpClientTransport,
{
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen_cursors = std::collections::HashSet::new();
    for page in 0..MAX_TOOL_PAGES {
        let id = u64::try_from(page).unwrap_or(0) + first_id;
        let mut params = if modern {
            serde_json::json!({"_meta": modern_request_metadata()})
        } else {
            serde_json::json!({})
        };
        if let Some(value) = cursor.as_ref() {
            params["cursor"] = serde_json::json!(value);
        }
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/list",
            "params": params
        });
        let response = required_response(transport.send(request).await?, "tools/list")?;
        let result = rpc_result(&response, id, "tools/list")?;
        if modern
            && result.get("resultType").and_then(serde_json::Value::as_str) != Some("complete")
        {
            return Err(protocol_error("tools/list returned an incomplete result"));
        }
        let page_tools = result
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| protocol_error("tools/list returned no tools array"))?;
        for tool in page_tools {
            let name = tool
                .get("name")
                .and_then(serde_json::Value::as_str)
                .filter(|name| !name.is_empty())
                .ok_or_else(|| protocol_error("tools/list returned a tool without a name"))?;
            if !tool
                .get("inputSchema")
                .is_some_and(serde_json::Value::is_object)
            {
                return Err(protocol_error(&format!(
                    "tools/list returned tool '{name}' without an object input schema"
                )));
            }
            let input_schema = tool["inputSchema"].clone();
            if modern
                && transport.uses_modern_http_headers()
                && mcp_header_bindings(&input_schema).is_err()
            {
                continue;
            }
            if tools.len() == MAX_TOOLS {
                return Err(protocol_error("tools/list exceeded the 2048-tool limit"));
            }
            let description = tool
                .get("description")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            tools.push(McpServerTool {
                name: name.to_string(),
                description,
                input_schema,
            });
        }
        cursor = match result.get("nextCursor") {
            None | Some(serde_json::Value::Null) => None,
            Some(value) => Some(
                value
                    .as_str()
                    .filter(|cursor| !cursor.is_empty())
                    .ok_or_else(|| protocol_error("tools/list returned an invalid cursor"))?
                    .to_string(),
            ),
        };
        let Some(next) = cursor.as_ref() else {
            return Ok(tools);
        };
        if !seen_cursors.insert(next.clone()) {
            return Err(protocol_error("tools/list repeated a pagination cursor"));
        }
    }
    Err(protocol_error("tools/list exceeded the 32-page limit"))
}

fn required_response(
    response: Option<serde_json::Value>,
    method: &str,
) -> Result<serde_json::Value, McpConnectionError> {
    response.ok_or_else(|| protocol_error(&format!("{method} returned no response")))
}

fn rpc_result<'a>(
    response: &'a serde_json::Value,
    id: u64,
    method: &str,
) -> Result<&'a serde_json::Value, McpConnectionError> {
    if response.get("jsonrpc").and_then(serde_json::Value::as_str) != Some("2.0") {
        return Err(protocol_error(&format!(
            "{method} returned an invalid JSON-RPC version"
        )));
    }
    if response.get("id") != Some(&serde_json::json!(id)) {
        return Err(protocol_error(&format!(
            "{method} returned a response with the wrong id"
        )));
    }
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown server error");
        return Err(protocol_error(&format!("{method} failed: {message}")));
    }
    response
        .get("result")
        .ok_or_else(|| protocol_error(&format!("{method} returned no result")))
}

fn protocol_error(detail: &str) -> McpConnectionError {
    McpConnectionError::Protocol {
        detail: detail.trim_end_matches('.').to_string(),
    }
}

fn modern_protocol_error(detail: &str) -> McpConnectionError {
    McpConnectionError::ModernProtocol {
        detail: detail.trim_end_matches('.').to_string(),
    }
}

#[cfg(test)]
fn parse_sse_response(
    source: &str,
    expected_id: u64,
) -> Result<serde_json::Value, McpConnectionError> {
    let mut decoder = SseDecoder::default();
    if let Some(response) = decoder.push(source.as_bytes(), expected_id)? {
        return Ok(response);
    }
    decoder.finish(expected_id)
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
    scanned: usize,
}

impl SseDecoder {
    fn push(
        &mut self,
        bytes: &[u8],
        expected_id: u64,
    ) -> Result<Option<serde_json::Value>, McpConnectionError> {
        let mut search_from = self.scanned.saturating_sub(3);
        self.buffer.extend_from_slice(bytes);
        let mut consumed = 0_usize;
        while let Some((event_end, delimiter_end)) =
            find_sse_boundary(&self.buffer, search_from.max(consumed))
        {
            let event = std::str::from_utf8(&self.buffer[consumed..event_end])
                .map_err(|_| protocol_error("server returned non-UTF-8 SSE data"))?;
            if let Some(response) = parse_sse_event(event, expected_id)? {
                return Ok(Some(response));
            }
            consumed = delimiter_end;
            search_from = delimiter_end;
        }
        if consumed > 0 {
            self.buffer.drain(..consumed);
        }
        self.scanned = self.buffer.len();
        if let Err(error) = std::str::from_utf8(&self.buffer) {
            if error.error_len().is_some() {
                return Err(protocol_error("server returned non-UTF-8 SSE data"));
            }
        }
        Ok(None)
    }

    fn finish(&mut self, expected_id: u64) -> Result<serde_json::Value, McpConnectionError> {
        if let Some(response) = self.push(&[], expected_id)? {
            return Ok(response);
        }
        Err(protocol_error(
            "server ended the SSE response before returning the requested result",
        ))
    }
}

fn find_sse_boundary(bytes: &[u8], start: usize) -> Option<(usize, usize)> {
    for index in start..bytes.len() {
        if bytes.get(index..index + 4) == Some(b"\r\n\r\n") {
            return Some((index, index + 4));
        }
        if bytes.get(index..index + 2) == Some(b"\n\n")
            || bytes.get(index..index + 2) == Some(b"\r\r")
        {
            return Some((index, index + 2));
        }
    }
    None
}

fn parse_sse_event(
    event: &str,
    expected_id: u64,
) -> Result<Option<serde_json::Value>, McpConnectionError> {
    let data = event
        .split(['\n', '\r'])
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() {
        return Ok(None);
    }
    let message: serde_json::Value = serde_json::from_str(&data)
        .map_err(|_| protocol_error("server returned invalid JSON in an SSE event"))?;
    match message.get("id") {
        Some(id) if id == &serde_json::json!(expected_id) => Ok(Some(message)),
        Some(_) => Err(protocol_error(
            "server returned a response with the wrong id",
        )),
        None => Ok(None),
    }
}

pub struct McpClientState {
    mutation: tokio::sync::Mutex<()>,
    validations: tokio::sync::Semaphore,
    agent_approvals: std::sync::Mutex<McpAgentApprovalRegistry>,
}

impl Default for McpClientState {
    fn default() -> Self {
        Self {
            mutation: tokio::sync::Mutex::new(()),
            validations: tokio::sync::Semaphore::new(MAX_CONCURRENT_VALIDATIONS),
            agent_approvals: std::sync::Mutex::new(McpAgentApprovalRegistry::default()),
        }
    }
}

impl McpClientState {
    fn authorize_agent_tool_at(
        &self,
        binding: McpAgentApprovalBinding<'_>,
        now: std::time::Instant,
    ) -> Result<String, String> {
        use base64::Engine as _;
        use rand::RngCore as _;

        let mut registry = self
            .agent_approvals
            .lock()
            .map_err(|_| "MCP tool approval is unavailable.".to_string())?;
        purge_agent_approvals(&mut registry, now);
        while registry.approvals.len() >= MAX_AGENT_APPROVALS {
            let Some(oldest) = registry.order.pop_front() else {
                registry.approvals.clear();
                break;
            };
            registry.approvals.remove(&oldest);
        }
        let token = loop {
            let mut bytes = [0_u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut bytes);
            let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
            if !registry.approvals.contains_key(&token) {
                break token;
            }
        };
        registry.order.push_back(token.clone());
        registry.approvals.insert(
            token.clone(),
            McpAgentApproval {
                project_id: binding.project_id.to_string(),
                server: binding.server.clone(),
                tool_handle: binding.tool_handle.to_string(),
                argument_digest: binding.argument_digest,
                run_id: binding.run_id.to_string(),
                run_generation: binding.run_generation,
                policy: binding.policy,
                expires_at: now + AGENT_APPROVAL_TTL,
            },
        );
        Ok(token)
    }

    fn preflight_agent_tool_at(
        &self,
        token: &str,
        binding: McpAgentApprovalBinding<'_>,
        now: std::time::Instant,
    ) -> Result<(), String> {
        let mut registry = self
            .agent_approvals
            .lock()
            .map_err(|_| "MCP tool approval is unavailable.".to_string())?;
        let result = match registry.approvals.get(token) {
            None => Err("MCP tool approval is invalid or has already been used.".to_string()),
            Some(approval) if approval.expires_at <= now => {
                Err("MCP tool approval has expired.".to_string())
            }
            Some(approval) if !agent_approval_matches(approval, &binding) => {
                Err("MCP tool approval does not match this call.".to_string())
            }
            Some(_) => Ok(()),
        };
        if result.is_err() {
            registry.approvals.remove(token);
            registry.order.retain(|candidate| candidate != token);
        }
        purge_agent_approvals(&mut registry, now);
        result
    }

    fn consume_agent_tool_at(
        &self,
        token: &str,
        binding: McpAgentApprovalBinding<'_>,
        now: std::time::Instant,
    ) -> Result<(), String> {
        let mut registry = self
            .agent_approvals
            .lock()
            .map_err(|_| "MCP tool approval is unavailable.".to_string())?;
        let approval = registry
            .approvals
            .remove(token)
            .ok_or_else(|| "MCP tool approval is invalid or has already been used.".to_string())?;
        registry.order.retain(|candidate| candidate != token);
        purge_agent_approvals(&mut registry, now);
        if approval.expires_at <= now {
            return Err("MCP tool approval has expired.".to_string());
        }
        if !agent_approval_matches(&approval, &binding) {
            return Err("MCP tool approval does not match this call.".to_string());
        }
        Ok(())
    }

    fn discard_agent_tool(&self, token: &str) {
        if let Ok(mut registry) = self.agent_approvals.lock() {
            registry.approvals.remove(token);
            registry.order.retain(|candidate| candidate != token);
        }
    }
}

fn purge_agent_approvals(registry: &mut McpAgentApprovalRegistry, now: std::time::Instant) {
    registry
        .approvals
        .retain(|_, approval| approval.expires_at > now);
    registry
        .order
        .retain(|token| registry.approvals.contains_key(token));
}

fn agent_approval_matches(
    approval: &McpAgentApproval,
    binding: &McpAgentApprovalBinding<'_>,
) -> bool {
    approval.project_id == binding.project_id
        && approval.server == *binding.server
        && approval.tool_handle == binding.tool_handle
        && approval.argument_digest == binding.argument_digest
        && approval.run_id == binding.run_id
        && approval.run_generation == binding.run_generation
        && approval.policy == binding.policy
}

fn acquire_validation_slot(
    state: &McpClientState,
) -> Result<tokio::sync::SemaphorePermit<'_>, String> {
    state
        .validations
        .try_acquire()
        .map_err(|_| "MCP validation is busy. Try again in a moment.".to_string())
}

fn validate_command_webview(webview_label: &str, window_label: &str) -> Result<(), String> {
    if webview_label == "main" && window_label == "main" {
        Ok(())
    } else {
        Err("MCP server settings are unavailable from this window.".into())
    }
}

fn visible_server(server: McpServerConfig) -> McpServerConfig {
    let mut config = AppConfig {
        mcp_servers: vec![server],
        ..AppConfig::default()
    };
    crate::config::redact_mcp_server_secrets(&mut config);
    config.mcp_servers.remove(0)
}

fn visible_managed_server(mut server: McpManagedServer) -> McpManagedServer {
    server.config = visible_server(server.config);
    server
}

fn checking_validation(server: &McpServerConfig) -> McpServerValidation {
    McpServerValidation {
        name: server.name.clone(),
        status: McpServerValidationStatus::Checking,
        tool_count: 0,
        tools: Vec::new(),
        error: None,
    }
}

fn validation_error(name: String, error: String) -> McpServerValidation {
    McpServerValidation {
        name,
        status: McpServerValidationStatus::Error,
        tool_count: 0,
        tools: Vec::new(),
        error: Some(error),
    }
}

fn load_enabled_server<R>(repository: &R, name: &str) -> Result<McpServerConfig, String>
where
    R: McpConfigRepository,
{
    let server = repository
        .load()?
        .mcp_servers
        .into_iter()
        .find(|server| server.name == name)
        .ok_or_else(|| format!("MCP server '{name}' was not found."))?;
    if !server.enabled {
        return Err(format!("MCP server '{name}' is disabled."));
    }
    normalize_server_config(server)
}

fn authorize_server_unchanged<R>(repository: &R, expected: &McpServerConfig) -> Result<(), String>
where
    R: McpConfigRepository,
{
    let current = repository
        .load()?
        .mcp_servers
        .into_iter()
        .find(|server| server.name == expected.name)
        .ok_or_else(|| {
            format!(
                "MCP server '{}' was removed before the tool call.",
                expected.name
            )
        })?;
    if !current.enabled {
        return Err(format!(
            "MCP server '{}' was disabled before the tool call.",
            expected.name
        ));
    }
    if current != *expected {
        return Err(format!(
            "MCP server '{}' changed before the tool call.",
            expected.name
        ));
    }
    Ok(())
}

fn validate_agent_tool_request(
    project_id: &str,
    server: &str,
    tool_handle: &str,
    arguments: &serde_json::Value,
    run_id: &str,
) -> Result<(String, [u8; 32]), String> {
    crate::paths::validate_project_id(project_id)?;
    let server = normalize_server_name(server)?;
    if tool_handle.is_empty()
        || tool_handle.len() > MAX_COMMAND_BYTES
        || tool_handle.chars().any(char::is_control)
    {
        return Err("The MCP tool handle is invalid.".into());
    }
    if run_id.trim().is_empty()
        || run_id.len() > MAX_COMMAND_BYTES
        || run_id.chars().any(char::is_control)
    {
        return Err("The agent run id is invalid.".into());
    }
    if !arguments.is_object()
        || serde_json::to_vec(arguments)
            .map_err(|_| "The MCP tool arguments could not be encoded.".to_string())?
            .len()
            > MAX_AGENT_TOOL_ARGUMENT_BYTES
    {
        return Err("MCP tool arguments must be an object no larger than 1 MiB.".into());
    }
    Ok((server, agent_argument_digest(arguments)))
}

fn agent_argument_digest(arguments: &serde_json::Value) -> [u8; 32] {
    use sha2::Digest as _;

    fn update(hasher: &mut sha2::Sha256, value: &serde_json::Value) {
        fn bytes(hasher: &mut sha2::Sha256, value: &[u8]) {
            use sha2::Digest as _;

            hasher.update((value.len() as u64).to_be_bytes());
            hasher.update(value);
        }

        use sha2::Digest as _;

        match value {
            serde_json::Value::Null => hasher.update([0]),
            serde_json::Value::Bool(value) => hasher.update([1, u8::from(*value)]),
            serde_json::Value::Number(value) => {
                hasher.update([2]);
                bytes(hasher, value.to_string().as_bytes());
            }
            serde_json::Value::String(value) => {
                hasher.update([3]);
                bytes(hasher, value.as_bytes());
            }
            serde_json::Value::Array(values) => {
                hasher.update([4]);
                hasher.update((values.len() as u64).to_be_bytes());
                for value in values {
                    update(hasher, value);
                }
            }
            serde_json::Value::Object(values) => {
                hasher.update([5]);
                hasher.update((values.len() as u64).to_be_bytes());
                let mut keys = values.keys().collect::<Vec<_>>();
                keys.sort_unstable();
                for key in keys {
                    bytes(hasher, key.as_bytes());
                    update(hasher, &values[key]);
                }
            }
        }
    }

    let mut hasher = sha2::Sha256::new();
    update(&mut hasher, arguments);
    hasher.finalize().into()
}

fn agent_tool_policy(
    root: &std::path::Path,
    project_id: &str,
    server: &str,
    tool_handle: &str,
) -> Result<McpAgentApprovalPolicy, String> {
    let (mode, decision) =
        crate::approvals::policy_for(root, project_id, &agent_tool_name(server, tool_handle))?;
    Ok(McpAgentApprovalPolicy { mode, decision })
}

fn ensure_agent_tool_policy_allowed(policy: McpAgentApprovalPolicy) -> Result<(), String> {
    if policy.decision == Some(crate::approvals::ToolDecision::Deny) {
        Err("This MCP tool is denied for this project.".to_string())
    } else {
        Ok(())
    }
}

fn agent_tool_policy_needs_confirmation(policy: McpAgentApprovalPolicy) -> bool {
    policy.mode != crate::approvals::ApprovalMode::FullAccess
        && policy.decision != Some(crate::approvals::ToolDecision::Allow)
}

fn validate_agent_tool_owner(
    agent_state: &crate::agent::AgentState,
    project_id: &str,
    run_id: &str,
    server: &str,
    tool_handle: &str,
) -> Result<u64, String> {
    if !crate::agent::request_owns_project(agent_state, run_id, project_id) {
        return Err("The agent run is not active for this project.".to_string());
    }
    let tool_name = agent_tool_name(server, tool_handle);
    crate::agent::request_tool_generation(agent_state, run_id, project_id, &tool_name)
        .ok_or_else(|| "This MCP tool is not available to the active agent run.".to_string())
}

struct McpAgentToolRequest<'a> {
    project_id: &'a str,
    server: &'a str,
    tool_handle: &'a str,
    arguments: &'a serde_json::Value,
    run_id: &'a str,
}

async fn authorize_agent_tool_after_confirmation<R, F, Fut>(
    state: &McpClientState,
    agent_state: &crate::agent::AgentState,
    repository: &R,
    root: &std::path::Path,
    request: McpAgentToolRequest<'_>,
    confirm: F,
) -> Result<String, String>
where
    R: McpConfigRepository,
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<bool, String>>,
{
    let run_generation = validate_agent_tool_owner(
        agent_state,
        request.project_id,
        request.run_id,
        request.server,
        request.tool_handle,
    )?;
    let server = load_enabled_server(repository, request.server)?;
    let policy = agent_tool_policy(root, request.project_id, &server.name, request.tool_handle)?;
    ensure_agent_tool_policy_allowed(policy)?;
    if agent_tool_policy_needs_confirmation(policy) {
        let message =
            agent_tool_confirmation_message(&server.name, request.tool_handle, request.arguments);
        if !confirm(message).await? {
            return Err("MCP tool approval was declined.".to_string());
        }
    }
    let current_generation = validate_agent_tool_owner(
        agent_state,
        request.project_id,
        request.run_id,
        &server.name,
        request.tool_handle,
    )?;
    if current_generation != run_generation {
        return Err("The agent run changed before the MCP tool was authorized.".to_string());
    }
    authorize_server_unchanged(repository, &server)?;
    let current_policy =
        agent_tool_policy(root, request.project_id, &server.name, request.tool_handle)?;
    ensure_agent_tool_policy_allowed(current_policy)?;
    if current_policy != policy {
        return Err("Approval settings changed before the MCP tool was authorized.".to_string());
    }
    state.authorize_agent_tool_at(
        McpAgentApprovalBinding {
            project_id: request.project_id,
            server: &server,
            tool_handle: request.tool_handle,
            argument_digest: agent_argument_digest(request.arguments),
            run_id: request.run_id,
            run_generation,
            policy,
        },
        std::time::Instant::now(),
    )
}

fn agent_tool_confirmation_message(
    server: &str,
    tool_handle: &str,
    arguments: &serde_json::Value,
) -> String {
    let arguments = serde_json::to_string_pretty(&redact_agent_confirmation_arguments(arguments))
        .unwrap_or_else(|_| "{}".to_string());
    let mut preview = arguments.chars().take(2_048).collect::<String>();
    if arguments.chars().count() > 2_048 {
        preview.push_str("...");
    }
    format!(
        "The assistant wants to use the {tool_handle} tool from the {server} MCP server.\n\nArguments:\n\n{preview}\n\nUse this tool?"
    )
}

fn redact_agent_confirmation_arguments(value: &serde_json::Value) -> serde_json::Value {
    fn credential_key(key: &str) -> bool {
        const PARTS: &[&str] = &[
            "accesskey",
            "accesstoken",
            "apikey",
            "authorization",
            "bearer",
            "clientsecret",
            "cookie",
            "credential",
            "idtoken",
            "password",
            "passwd",
            "privatekey",
            "refreshtoken",
            "secret",
            "sessionid",
            "token",
        ];
        let normalized = key
            .bytes()
            .filter(u8::is_ascii_alphanumeric)
            .map(|byte| char::from(byte.to_ascii_lowercase()))
            .collect::<String>();
        PARTS.iter().any(|part| {
            normalized == *part || normalized.starts_with(part) || normalized.ends_with(part)
        })
    }

    match value {
        serde_json::Value::Array(values) => serde_json::Value::Array(
            values
                .iter()
                .map(redact_agent_confirmation_arguments)
                .collect(),
        ),
        serde_json::Value::Object(values) => serde_json::Value::Object(
            values
                .iter()
                .map(|(key, value)| {
                    let value = if credential_key(key) {
                        serde_json::Value::String("[redacted]".to_string())
                    } else {
                        redact_agent_confirmation_arguments(value)
                    };
                    (key.clone(), value)
                })
                .collect(),
        ),
        value => value.clone(),
    }
}

async fn native_agent_tool_confirmation(
    app: tauri::AppHandle,
    message: String,
) -> Result<bool, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title("Approve MCP tool")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Use tool".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    receiver
        .await
        .map_err(|_| "The native approval dialog closed unexpectedly.".to_string())
}

#[allow(clippy::too_many_arguments)]
fn ensure_agent_tool_binding<R>(
    state: &McpClientState,
    agent_state: &crate::agent::AgentState,
    repository: &R,
    root: &std::path::Path,
    token: &str,
    project_id: &str,
    tool_handle: &str,
    run_id: &str,
    server: &McpServerConfig,
    argument_digest: [u8; 32],
    consume: bool,
) -> Result<(), String>
where
    R: McpConfigRepository,
{
    let checked = (|| {
        let run_generation =
            validate_agent_tool_owner(agent_state, project_id, run_id, &server.name, tool_handle)?;
        authorize_server_unchanged(repository, server)?;
        let policy = agent_tool_policy(root, project_id, &server.name, tool_handle)?;
        ensure_agent_tool_policy_allowed(policy)?;
        Ok::<_, String>((run_generation, policy))
    })();
    let (run_generation, policy) = match checked {
        Ok(checked) => checked,
        Err(error) => {
            if consume {
                state.discard_agent_tool(token);
            }
            return Err(error);
        }
    };
    let binding = McpAgentApprovalBinding {
        project_id,
        server,
        tool_handle,
        argument_digest,
        run_id,
        run_generation,
        policy,
    };
    if consume {
        state.consume_agent_tool_at(token, binding, std::time::Instant::now())?;
        let current_generation =
            validate_agent_tool_owner(agent_state, project_id, run_id, &server.name, tool_handle)?;
        if current_generation != run_generation {
            return Err("The agent run changed before the MCP tool call.".to_string());
        }
        authorize_server_unchanged(repository, server)?;
        let current_policy = agent_tool_policy(root, project_id, &server.name, tool_handle)?;
        ensure_agent_tool_policy_allowed(current_policy)?;
        if current_policy != policy {
            return Err("Approval settings changed before the MCP tool call.".to_string());
        }
        Ok(())
    } else {
        state.preflight_agent_tool_at(token, binding, std::time::Instant::now())
    }
}

#[tauri::command]
pub async fn mcp_agent_tools_list<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, McpClientState>,
) -> Result<Vec<McpAgentServer>, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let mut servers = AppConfigRepository
        .load()?
        .mcp_servers
        .into_iter()
        .filter(|server| server.enabled)
        .filter_map(|server| normalize_server_config(server).ok())
        .collect::<Vec<_>>();
    servers.sort_by(|left, right| left.name.cmp(&right.name));
    let discoveries = futures_util::stream::iter(servers).map(|server| {
        let state = &state;
        async move {
            let _permit = state.validations.acquire().await.ok()?;
            let tools = connect_server(server.clone()).await.ok()?;
            authorize_server_unchanged(&AppConfigRepository, &server).ok()?;
            Some((server, tools))
        }
    });
    let mut discoveries = discoveries.buffer_unordered(MAX_CONCURRENT_VALIDATIONS);
    let deadline = tokio::time::Instant::now() + AGENT_TOOL_TIMEOUT;
    let mut connected = Vec::new();
    loop {
        match tokio::time::timeout_at(deadline, discoveries.next()).await {
            Ok(Some(Some(server))) => connected.push(server),
            Ok(Some(None)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    Ok(build_agent_tool_catalog(connected))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mcp_agent_tool_authorize<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    app: tauri::AppHandle,
    state: tauri::State<'_, McpClientState>,
    agent_state: tauri::State<'_, crate::agent::AgentState>,
    project_id: String,
    server: String,
    tool_handle: String,
    arguments: serde_json::Value,
    run_id: String,
) -> Result<String, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let (server, _) =
        validate_agent_tool_request(&project_id, &server, &tool_handle, &arguments, &run_id)?;
    crate::paths::project_dir(&project_id)?;
    let root = crate::paths::oleafly_root()?;
    authorize_agent_tool_after_confirmation(
        state.inner(),
        agent_state.inner(),
        &AppConfigRepository,
        &root,
        McpAgentToolRequest {
            project_id: &project_id,
            server: &server,
            tool_handle: &tool_handle,
            arguments: &arguments,
            run_id: &run_id,
        },
        move |message| native_agent_tool_confirmation(app, message),
    )
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mcp_agent_tool_call<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, McpClientState>,
    agent_state: tauri::State<'_, crate::agent::AgentState>,
    project_id: String,
    server: String,
    tool_handle: String,
    arguments: serde_json::Value,
    run_id: String,
    approval_token: String,
) -> Result<serde_json::Value, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    if approval_token.is_empty() {
        return Err("MCP tool approval is required.".to_string());
    }
    let (server_name, argument_digest) =
        validate_agent_tool_request(&project_id, &server, &tool_handle, &arguments, &run_id)?;
    crate::paths::project_dir(&project_id)?;
    let root = crate::paths::oleafly_root()?;
    let deadline = tokio::time::Instant::now() + AGENT_TOOL_TIMEOUT;
    let server = load_enabled_server(&AppConfigRepository, &server_name)?;
    ensure_agent_tool_binding(
        state.inner(),
        agent_state.inner(),
        &AppConfigRepository,
        &root,
        &approval_token,
        &project_id,
        &tool_handle,
        &run_id,
        &server,
        argument_digest,
        false,
    )?;
    let _permit = tokio::time::timeout_at(deadline, state.validations.acquire())
        .await
        .map_err(|_| "MCP tool call timed out after 15 seconds.".to_string())?
        .map_err(|_| "MCP tool execution is unavailable.".to_string())?;
    let expected = server.clone();
    let late_project_id = project_id.clone();
    let late_tool_handle = tool_handle.clone();
    let late_run_id = run_id.clone();
    let late_approval_token = approval_token.clone();
    let result = connect_server_and_call_until(
        server.clone(),
        &tool_handle,
        arguments,
        || {
            ensure_agent_tool_binding(
                state.inner(),
                agent_state.inner(),
                &AppConfigRepository,
                &root,
                &late_approval_token,
                &late_project_id,
                &late_tool_handle,
                &late_run_id,
                &expected,
                argument_digest,
                true,
            )
            .map_err(|error| protocol_error(&error))
        },
        deadline,
    )
    .await
    .map_err(|error| redact_server_values(&server, error.to_string()))?;
    let matcher = server_value_matcher(&server)
        .map_err(|_| "MCP tool result could not be returned safely.".to_string())?;
    Ok(redact_json_value(result, matcher.as_ref()))
}

#[tauri::command]
pub async fn mcp_servers_list<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
) -> Result<Vec<McpManagedServer>, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let config = AppConfigRepository.load()?;
    Ok(config
        .mcp_servers
        .into_iter()
        .map(|server| {
            let validation = if server.enabled {
                checking_validation(&server)
            } else {
                disabled_validation(&server)
            };
            visible_managed_server(McpManagedServer {
                config: server,
                validation,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn mcp_server_validate<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, McpClientState>,
    name: String,
) -> Result<McpServerValidation, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let name = normalize_server_name(&name)?;
    let config = AppConfigRepository.load()?;
    let server = config
        .mcp_servers
        .into_iter()
        .find(|server| server.name == name)
        .ok_or_else(|| format!("MCP server '{name}' was not found."))?;
    let server = match normalize_server_config(server) {
        Ok(server) => server,
        Err(error) => return Ok(validation_error(name, error)),
    };
    let _permit = acquire_validation_slot(&state)?;
    Ok(validate_with(&server, connect_server).await)
}

#[tauri::command]
pub async fn mcp_server_add<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, McpClientState>,
    server: McpServerConfig,
) -> Result<McpManagedServer, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let _guard = state.mutation.lock().await;
    let _permit = acquire_validation_slot(&state)?;
    add_server_with(&AppConfigRepository, server, connect_server)
        .await
        .map(visible_managed_server)
}

#[tauri::command]
pub async fn mcp_server_update<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, McpClientState>,
    original_name: String,
    server: McpServerConfig,
) -> Result<McpManagedServer, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let original_name = normalize_server_name(&original_name)?;
    let _guard = state.mutation.lock().await;
    let _permit = server
        .enabled
        .then(|| acquire_validation_slot(&state))
        .transpose()?;
    edit_server_with(&AppConfigRepository, &original_name, server, connect_server)
        .await
        .map(visible_managed_server)
}

#[tauri::command]
pub async fn mcp_server_set_enabled<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, McpClientState>,
    name: String,
    enabled: bool,
) -> Result<McpManagedServer, String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let name = normalize_server_name(&name)?;
    let _guard = state.mutation.lock().await;
    let _permit = enabled
        .then(|| acquire_validation_slot(&state))
        .transpose()?;
    set_server_enabled_with(&AppConfigRepository, &name, enabled, connect_server)
        .await
        .map(visible_managed_server)
}

#[tauri::command]
pub async fn mcp_server_remove<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, McpClientState>,
    name: String,
) -> Result<(), String> {
    validate_command_webview(webview.label(), webview.window().label())?;
    let name = normalize_server_name(&name)?;
    let _guard = state.mutation.lock().await;
    remove_server_with(&AppConfigRepository, &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, McpServerConfig, McpServerTransport};
    use std::collections::BTreeMap;
    use std::collections::VecDeque;
    use std::future::Future;
    use std::path::PathBuf;
    use std::pin::Pin;

    fn stdio_server(command: &str) -> McpServerConfig {
        McpServerConfig {
            name: "local-search".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: command.into(),
                args: vec!["--stdio".into()],
                env: BTreeMap::new(),
            },
        }
    }

    struct DiskRepository {
        path: PathBuf,
    }

    impl McpConfigRepository for DiskRepository {
        fn load(&self) -> Result<AppConfig, String> {
            let source = std::fs::read_to_string(&self.path).map_err(|error| error.to_string())?;
            serde_json::from_str(&source).map_err(|error| error.to_string())
        }

        fn update<F>(&self, update: F) -> Result<(), String>
        where
            F: FnOnce(&mut AppConfig) -> Result<(), String>,
        {
            let mut config = self.load()?;
            update(&mut config)?;
            let source =
                serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
            std::fs::write(&self.path, source).map_err(|error| error.to_string())
        }
    }

    fn disk_repository() -> (tempfile::TempDir, DiskRepository) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        std::fs::write(&path, serde_json::to_vec(&AppConfig::default()).unwrap()).unwrap();
        (directory, DiskRepository { path })
    }

    fn remote_server(name: &str) -> McpServerConfig {
        McpServerConfig {
            name: name.into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: "https://mcp.example.test/mcp".into(),
                headers: BTreeMap::from([("Authorization".into(), "Bearer token".into())]),
            },
        }
    }

    fn persist_server(repository: &DiskRepository, server: McpServerConfig) {
        repository
            .update(|config| {
                config.mcp_servers = vec![server];
                Ok(())
            })
            .unwrap();
    }

    fn register_agent_run(
        state: &crate::agent::AgentState,
        run_id: &str,
        project_id: &str,
        tools: impl IntoIterator<Item = String>,
    ) -> u64 {
        let generation = crate::agent::register_active_request_for_test(state, run_id);
        crate::agent::register_run_project_for_test(state, run_id, generation, project_id);
        crate::agent::register_run_tools_for_test(state, run_id, generation, tools);
        generation
    }

    async fn good_connect(
        _server: McpServerConfig,
    ) -> Result<Vec<McpServerTool>, McpConnectionError> {
        Ok(vec![McpServerTool {
            name: "search".into(),
            description: None,
            input_schema: serde_json::json!({"type": "object"}),
        }])
    }

    struct FakeTransport {
        replies: VecDeque<Result<Option<serde_json::Value>, McpConnectionError>>,
        sent: Vec<serde_json::Value>,
    }

    impl McpClientTransport for FakeTransport {
        fn send<'a>(
            &'a mut self,
            message: serde_json::Value,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                self.sent.push(message);
                self.replies.pop_front().unwrap()
            })
        }
    }

    struct ModernHttpFakeTransport {
        replies: VecDeque<Result<Option<serde_json::Value>, McpConnectionError>>,
        sent: Vec<serde_json::Value>,
        headers: Vec<BTreeMap<String, String>>,
    }

    impl McpClientTransport for ModernHttpFakeTransport {
        fn send<'a>(
            &'a mut self,
            message: serde_json::Value,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                self.sent.push(message);
                self.headers.push(BTreeMap::new());
                self.replies.pop_front().unwrap()
            })
        }

        fn uses_modern_http_headers(&self) -> bool {
            true
        }

        fn send_with_headers<'a>(
            &'a mut self,
            message: serde_json::Value,
            headers: BTreeMap<String, String>,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<Option<serde_json::Value>, McpConnectionError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                self.sent.push(message);
                self.headers.push(headers);
                self.replies.pop_front().unwrap()
            })
        }
    }

    #[test]
    fn agent_tool_names_are_stable_provider_safe_and_collision_resistant() {
        let first = agent_tool_name("Paper Search", "find/papers");
        let repeated = agent_tool_name("Paper Search", "find/papers");
        let other_server = agent_tool_name("Archive Search", "find/papers");
        let long = agent_tool_name(&"server".repeat(20), &"tool".repeat(40));

        assert_eq!(first, repeated);
        assert_ne!(first, other_server);
        assert!(first.starts_with("mcp_ext_"));
        assert!(first
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')));
        assert!(long.len() <= 64);
        assert_ne!(first, "read_file");
    }

    #[test]
    fn modern_header_values_use_the_required_base64_sentinel() {
        assert_eq!(encode_modern_header_value("search").unwrap(), "search");
        assert_eq!(
            encode_modern_header_value("Hello, 世界").unwrap(),
            "=?base64?SGVsbG8sIOS4lueVjA==?="
        );
        assert_eq!(
            encode_modern_header_value(" padded ").unwrap(),
            "=?base64?IHBhZGRlZCA=?="
        );
        assert_eq!(
            encode_modern_header_value("=?base64?literal?=").unwrap(),
            "=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?="
        );
        assert_eq!(
            encode_modern_header_value("line1\nline2").unwrap(),
            "=?base64?bGluZTEKbGluZTI=?="
        );
    }

    #[test]
    fn mcp_parameter_headers_follow_nested_property_paths_and_primitive_types() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "region": {"type": "string", "x-mcp-header": "Region"},
                "context": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean", "x-mcp-header": "Enabled"},
                        "count": {"type": "integer", "x-mcp-header": "Count"},
                        "optional": {"type": "string", "x-mcp-header": "Optional"}
                    }
                }
            }
        });

        let headers = mirrored_tool_headers(
            &schema,
            &serde_json::json!({
                "region": "Hello, 世界",
                "context": {"enabled": false, "count": -7, "optional": null}
            }),
        )
        .unwrap();

        assert_eq!(
            headers["Mcp-Param-Region"],
            "=?base64?SGVsbG8sIOS4lueVjA==?="
        );
        assert_eq!(headers["Mcp-Param-Enabled"], "false");
        assert_eq!(headers["Mcp-Param-Count"], "-7");
        assert!(!headers.contains_key("Mcp-Param-Optional"));
    }

    #[test]
    fn invalid_mcp_header_schema_extensions_are_rejected() {
        let invalid = [
            serde_json::json!({"type": "object", "x-mcp-header": "Root"}),
            serde_json::json!({
                "type": "object",
                "properties": {"value": {"type": "string", "x-mcp-header": "Bad\r\nName"}}
            }),
            serde_json::json!({
                "type": "object",
                "properties": {
                    "first": {"type": "string", "x-mcp-header": "Region"},
                    "second": {"type": "boolean", "x-mcp-header": "region"}
                }
            }),
            serde_json::json!({
                "type": "object",
                "properties": {"value": {"type": "number", "x-mcp-header": "Value"}}
            }),
            serde_json::json!({
                "type": "object",
                "properties": {
                    "values": {
                        "type": "array",
                        "items": {"type": "string", "x-mcp-header": "Item"}
                    }
                }
            }),
            serde_json::json!({
                "type": "object",
                "oneOf": [{
                    "properties": {"value": {"type": "string", "x-mcp-header": "Value"}}
                }]
            }),
        ];

        for schema in invalid {
            assert!(mcp_header_bindings(&schema).is_err());
        }

        let integer_schema = serde_json::json!({
            "type": "object",
            "properties": {"count": {"type": "integer", "x-mcp-header": "Count"}}
        });
        assert!(mirrored_tool_headers(
            &integer_schema,
            &serde_json::json!({"count": 9_007_199_254_740_992_u64})
        )
        .is_err());
    }

    #[test]
    fn agent_tool_catalog_is_sorted_and_redacts_server_secrets() {
        let mut secret_server = stdio_server("search-server");
        secret_server.name = "papers".into();
        let McpServerTransport::Stdio { env, .. } = &mut secret_server.transport else {
            unreachable!();
        };
        env.insert("MCP_SECRET".into(), "private-token".into());
        let tools = vec![
            McpServerTool {
                name: "zeta".into(),
                description: Some("Uses private-token internally".into()),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "private-token query"}
                    }
                }),
            },
            McpServerTool {
                name: "alpha".into(),
                description: None,
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "context": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "x-mcp-header": "Query"}
                            }
                        }
                    }
                }),
            },
            McpServerTool {
                name: "private-token-tool".into(),
                description: None,
                input_schema: serde_json::json!({"type": "object"}),
            },
        ];

        let servers = build_agent_tool_catalog(vec![(secret_server, tools)]);

        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "papers");
        assert_eq!(servers[0].tools.len(), 2);
        assert_eq!(servers[0].tools[0].tool_handle, "alpha");
        assert_eq!(servers[0].tools[1].tool_handle, "zeta");
        assert!(servers[0].tools[0]
            .input_schema
            .pointer("/properties/context/properties/query/x-mcp-header")
            .is_none());
        assert_eq!(
            servers[0].tools[0]
                .input_schema
                .pointer("/properties/context/properties/query/type"),
            Some(&serde_json::json!("string"))
        );
        assert_eq!(
            servers[0].tools[1].description.as_deref(),
            Some("Uses [stored value] internally")
        );
        assert_eq!(
            servers[0].tools[1].input_schema["properties"]["query"]["description"],
            "[stored value] query"
        );
        assert!(!serde_json::to_string(&servers)
            .unwrap()
            .contains("private-token"));
    }

    #[test]
    fn agent_tool_result_redaction_preserves_non_secret_text() {
        let matcher = aho_corasick::AhoCorasick::new(["private-token"]).unwrap();
        let long_text = "x".repeat(4_096);
        let value = serde_json::json!({
            "content": [{"type": "text", "text": long_text}],
            "metadata": {"credential": "private-token"}
        });

        let redacted = redact_json_value(value, Some(&matcher));

        assert_eq!(redacted["content"][0]["text"], "x".repeat(4_096));
        assert_eq!(redacted["metadata"]["credential"], "[stored value]");
    }

    #[test]
    fn agent_tool_catalog_returns_every_discovered_tool_in_deterministic_order() {
        let servers = (0..4)
            .rev()
            .map(|server_index| {
                let mut server = stdio_server("search-server");
                server.name = format!("server-{server_index}");
                let tools = (0..24)
                    .rev()
                    .map(|tool_index| McpServerTool {
                        name: format!("tool-{tool_index:02}"),
                        description: None,
                        input_schema: serde_json::json!({"type": "object"}),
                    })
                    .collect();
                (server, tools)
            })
            .collect();

        let catalog = build_agent_tool_catalog(servers);
        let names = catalog
            .iter()
            .flat_map(|server| {
                server
                    .tools
                    .iter()
                    .map(move |tool| format!("{}:{}", server.name, tool.tool_handle))
            })
            .collect::<Vec<_>>();

        assert_eq!(names.len(), 96);
        assert_eq!(names[0], "server-0:tool-00");
        assert_eq!(names[63], "server-2:tool-15");
        assert_eq!(names[95], "server-3:tool-23");
    }

    #[test]
    fn agent_server_authorization_rejects_disabled_and_raced_configs() {
        let (_directory, repository) = disk_repository();
        let mut server = stdio_server("search-server");
        server.enabled = false;
        repository
            .update(|config| {
                config.mcp_servers = vec![server.clone()];
                Ok(())
            })
            .unwrap();

        assert_eq!(
            load_enabled_server(&repository, "local-search").unwrap_err(),
            "MCP server 'local-search' is disabled."
        );

        server.enabled = true;
        repository
            .update(|config| {
                config.mcp_servers = vec![server.clone()];
                Ok(())
            })
            .unwrap();
        let expected = load_enabled_server(&repository, "local-search").unwrap();
        repository
            .update(|config| {
                config.mcp_servers[0].enabled = false;
                Ok(())
            })
            .unwrap();

        assert_eq!(
            authorize_server_unchanged(&repository, &expected).unwrap_err(),
            "MCP server 'local-search' was disabled before the tool call."
        );
    }

    #[tokio::test]
    async fn agent_tool_authorization_requires_active_run_ownership() {
        let (_directory, repository) = disk_repository();
        let server = stdio_server("search-server");
        persist_server(&repository, server);
        let root = tempfile::tempdir().unwrap();
        let state = McpClientState::default();
        let agent_state = crate::agent::AgentState::default();
        let arguments = serde_json::json!({"query": "rust"});

        let error = authorize_agent_tool_after_confirmation(
            &state,
            &agent_state,
            &repository,
            root.path(),
            McpAgentToolRequest {
                project_id: "project-1",
                server: "local-search",
                tool_handle: "search",
                arguments: &arguments,
                run_id: "run-inactive",
            },
            |_| async { Ok(true) },
        )
        .await
        .unwrap_err();

        assert_eq!(error, "The agent run is not active for this project.");
        assert!(state.agent_approvals.lock().unwrap().approvals.is_empty());
    }

    #[tokio::test]
    async fn full_access_cannot_authorize_a_tool_absent_from_the_run() {
        let (_directory, repository) = disk_repository();
        let server = stdio_server("search-server");
        persist_server(&repository, server);
        let root = tempfile::tempdir().unwrap();
        crate::approvals::set_mode(
            root.path(),
            "project-1",
            crate::approvals::ApprovalMode::FullAccess,
        )
        .unwrap();
        let state = McpClientState::default();
        let agent_state = crate::agent::AgentState::default();
        let generation = register_agent_run(
            &agent_state,
            "run-unadvertised",
            "project-1",
            std::iter::empty(),
        );
        let arguments = serde_json::json!({"query": "rust"});

        let error = authorize_agent_tool_after_confirmation(
            &state,
            &agent_state,
            &repository,
            root.path(),
            McpAgentToolRequest {
                project_id: "project-1",
                server: "local-search",
                tool_handle: "search",
                arguments: &arguments,
                run_id: "run-unadvertised",
            },
            |_| async { panic!("full access must not confirm an unadvertised tool") },
        )
        .await
        .unwrap_err();

        crate::agent::finish_active_request_for_test(&agent_state, "run-unadvertised", generation);
        assert_eq!(
            error,
            "This MCP tool is not available to the active agent run."
        );
        assert!(state.agent_approvals.lock().unwrap().approvals.is_empty());
    }

    #[tokio::test]
    async fn denied_and_declined_agent_tool_calls_mint_no_approval() {
        let (_directory, repository) = disk_repository();
        let server = stdio_server("search-server");
        persist_server(&repository, server);
        let root = tempfile::tempdir().unwrap();
        let state = McpClientState::default();
        let agent_state = crate::agent::AgentState::default();
        let callable = agent_tool_name("local-search", "search");
        let generation =
            register_agent_run(&agent_state, "run-policy", "project-1", [callable.clone()]);
        let arguments = serde_json::json!({"query": "rust"});
        crate::approvals::set_decision(
            root.path(),
            "project-1",
            &callable,
            Some(crate::approvals::ToolDecision::Deny),
        )
        .unwrap();

        let denied = authorize_agent_tool_after_confirmation(
            &state,
            &agent_state,
            &repository,
            root.path(),
            McpAgentToolRequest {
                project_id: "project-1",
                server: "local-search",
                tool_handle: "search",
                arguments: &arguments,
                run_id: "run-policy",
            },
            |_| async { panic!("denied tools must not open a confirmation") },
        )
        .await
        .unwrap_err();
        crate::approvals::set_decision(root.path(), "project-1", &callable, None).unwrap();
        let declined = authorize_agent_tool_after_confirmation(
            &state,
            &agent_state,
            &repository,
            root.path(),
            McpAgentToolRequest {
                project_id: "project-1",
                server: "local-search",
                tool_handle: "search",
                arguments: &arguments,
                run_id: "run-policy",
            },
            |_| async { Ok(false) },
        )
        .await
        .unwrap_err();

        crate::agent::finish_active_request_for_test(&agent_state, "run-policy", generation);
        assert_eq!(denied, "This MCP tool is denied for this project.");
        assert_eq!(declined, "MCP tool approval was declined.");
        assert!(state.agent_approvals.lock().unwrap().approvals.is_empty());
    }

    #[tokio::test]
    async fn agent_tool_approval_is_bound_and_consumed_once_at_the_late_boundary() {
        let (_directory, repository) = disk_repository();
        let server = stdio_server("search-server");
        persist_server(&repository, server.clone());
        let root = tempfile::tempdir().unwrap();
        crate::approvals::set_mode(
            root.path(),
            "project-1",
            crate::approvals::ApprovalMode::FullAccess,
        )
        .unwrap();
        let state = McpClientState::default();
        let agent_state = crate::agent::AgentState::default();
        let callable = agent_tool_name("local-search", "search");
        let generation = register_agent_run(&agent_state, "run-once", "project-1", [callable]);
        let arguments = serde_json::json!({"query": "rust", "limit": 4});
        let token = authorize_agent_tool_after_confirmation(
            &state,
            &agent_state,
            &repository,
            root.path(),
            McpAgentToolRequest {
                project_id: "project-1",
                server: "local-search",
                tool_handle: "search",
                arguments: &arguments,
                run_id: "run-once",
            },
            |_| async { panic!("full access must not open a confirmation") },
        )
        .await
        .unwrap();
        let digest = agent_argument_digest(&arguments);

        ensure_agent_tool_binding(
            &state,
            &agent_state,
            &repository,
            root.path(),
            &token,
            "project-1",
            "search",
            "run-once",
            &server,
            digest,
            false,
        )
        .unwrap();
        ensure_agent_tool_binding(
            &state,
            &agent_state,
            &repository,
            root.path(),
            &token,
            "project-1",
            "search",
            "run-once",
            &server,
            digest,
            true,
        )
        .unwrap();
        let replay = ensure_agent_tool_binding(
            &state,
            &agent_state,
            &repository,
            root.path(),
            &token,
            "project-1",
            "search",
            "run-once",
            &server,
            digest,
            true,
        )
        .unwrap_err();

        crate::agent::finish_active_request_for_test(&agent_state, "run-once", generation);
        assert_eq!(
            replay,
            "MCP tool approval is invalid or has already been used."
        );
    }

    #[tokio::test]
    async fn argument_mismatch_burns_the_agent_tool_approval() {
        let (_directory, repository) = disk_repository();
        let server = stdio_server("search-server");
        persist_server(&repository, server.clone());
        let root = tempfile::tempdir().unwrap();
        crate::approvals::set_mode(
            root.path(),
            "project-1",
            crate::approvals::ApprovalMode::FullAccess,
        )
        .unwrap();
        let state = McpClientState::default();
        let agent_state = crate::agent::AgentState::default();
        let callable = agent_tool_name("local-search", "search");
        let generation = register_agent_run(&agent_state, "run-mismatch", "project-1", [callable]);
        let approved_arguments = serde_json::json!({"query": "rust"});
        let token = authorize_agent_tool_after_confirmation(
            &state,
            &agent_state,
            &repository,
            root.path(),
            McpAgentToolRequest {
                project_id: "project-1",
                server: "local-search",
                tool_handle: "search",
                arguments: &approved_arguments,
                run_id: "run-mismatch",
            },
            |_| async { Ok(true) },
        )
        .await
        .unwrap();

        let mismatch = ensure_agent_tool_binding(
            &state,
            &agent_state,
            &repository,
            root.path(),
            &token,
            "project-1",
            "search",
            "run-mismatch",
            &server,
            agent_argument_digest(&serde_json::json!({"query": "other"})),
            false,
        )
        .unwrap_err();
        let burned = ensure_agent_tool_binding(
            &state,
            &agent_state,
            &repository,
            root.path(),
            &token,
            "project-1",
            "search",
            "run-mismatch",
            &server,
            agent_argument_digest(&approved_arguments),
            false,
        )
        .unwrap_err();

        crate::agent::finish_active_request_for_test(&agent_state, "run-mismatch", generation);
        assert_eq!(mismatch, "MCP tool approval does not match this call.");
        assert_eq!(
            burned,
            "MCP tool approval is invalid or has already been used."
        );
    }

    #[tokio::test]
    async fn stopping_a_run_burns_a_preflighted_approval_before_the_tool_call() {
        let (_directory, repository) = disk_repository();
        let server = stdio_server("search-server");
        persist_server(&repository, server.clone());
        let root = tempfile::tempdir().unwrap();
        crate::approvals::set_mode(
            root.path(),
            "project-1",
            crate::approvals::ApprovalMode::FullAccess,
        )
        .unwrap();
        let state = McpClientState::default();
        let agent_state = crate::agent::AgentState::default();
        let callable = agent_tool_name("local-search", "search");
        let generation = register_agent_run(&agent_state, "run-stopped", "project-1", [callable]);
        let arguments = serde_json::json!({"query": "rust"});
        let digest = agent_argument_digest(&arguments);
        let token = authorize_agent_tool_after_confirmation(
            &state,
            &agent_state,
            &repository,
            root.path(),
            McpAgentToolRequest {
                project_id: "project-1",
                server: "local-search",
                tool_handle: "search",
                arguments: &arguments,
                run_id: "run-stopped",
            },
            |_| async { Ok(true) },
        )
        .await
        .unwrap();
        ensure_agent_tool_binding(
            &state,
            &agent_state,
            &repository,
            root.path(),
            &token,
            "project-1",
            "search",
            "run-stopped",
            &server,
            digest,
            false,
        )
        .unwrap();

        crate::agent::finish_active_request_for_test(&agent_state, "run-stopped", generation);
        let error = ensure_agent_tool_binding(
            &state,
            &agent_state,
            &repository,
            root.path(),
            &token,
            "project-1",
            "search",
            "run-stopped",
            &server,
            digest,
            true,
        )
        .unwrap_err();

        assert_eq!(error, "The agent run is not active for this project.");
        assert!(state.agent_approvals.lock().unwrap().approvals.is_empty());
    }

    #[test]
    fn expired_agent_tool_approvals_are_rejected_and_purged() {
        let state = McpClientState::default();
        let server = stdio_server("search-server");
        let policy = McpAgentApprovalPolicy {
            mode: crate::approvals::ApprovalMode::FullAccess,
            decision: None,
        };
        let digest = agent_argument_digest(&serde_json::json!({"query": "rust"}));
        let start = std::time::Instant::now();
        let token = state
            .authorize_agent_tool_at(
                McpAgentApprovalBinding {
                    project_id: "project-1",
                    server: &server,
                    tool_handle: "search",
                    argument_digest: digest,
                    run_id: "run-expired",
                    run_generation: 4,
                    policy,
                },
                start,
            )
            .unwrap();

        let error = state
            .preflight_agent_tool_at(
                &token,
                McpAgentApprovalBinding {
                    project_id: "project-1",
                    server: &server,
                    tool_handle: "search",
                    argument_digest: digest,
                    run_id: "run-expired",
                    run_generation: 4,
                    policy,
                },
                start + AGENT_APPROVAL_TTL,
            )
            .unwrap_err();

        assert_eq!(error, "MCP tool approval has expired.");
        assert!(state.agent_approvals.lock().unwrap().approvals.is_empty());
    }

    #[test]
    fn agent_tool_approval_registry_evicts_the_oldest_entry_at_its_bound() {
        let state = McpClientState::default();
        let server = stdio_server("search-server");
        let policy = McpAgentApprovalPolicy {
            mode: crate::approvals::ApprovalMode::FullAccess,
            decision: None,
        };
        let digest = agent_argument_digest(&serde_json::json!({"query": "rust"}));
        let now = std::time::Instant::now();
        let mut tokens = Vec::new();
        for _ in 0..=MAX_AGENT_APPROVALS {
            tokens.push(
                state
                    .authorize_agent_tool_at(
                        McpAgentApprovalBinding {
                            project_id: "project-1",
                            server: &server,
                            tool_handle: "search",
                            argument_digest: digest,
                            run_id: "run-bounded",
                            run_generation: 7,
                            policy,
                        },
                        now,
                    )
                    .unwrap(),
            );
        }

        let first = state
            .preflight_agent_tool_at(
                &tokens[0],
                McpAgentApprovalBinding {
                    project_id: "project-1",
                    server: &server,
                    tool_handle: "search",
                    argument_digest: digest,
                    run_id: "run-bounded",
                    run_generation: 7,
                    policy,
                },
                now,
            )
            .unwrap_err();

        assert_eq!(
            first,
            "MCP tool approval is invalid or has already been used."
        );
        assert_eq!(
            state.agent_approvals.lock().unwrap().approvals.len(),
            MAX_AGENT_APPROVALS
        );
    }

    #[test]
    fn native_agent_tool_confirmation_redacts_nested_credentials() {
        let message = agent_tool_confirmation_message(
            "papers",
            "search",
            &serde_json::json!({
                "query": "rust",
                "api_key": "secret-api-value",
                "nested": [{
                    "Authorization": "Bearer private-value",
                    "client-secret": "client-value",
                    "cookieJar": "cookie-value",
                    "private_key": "private-key-value"
                }]
            }),
        );

        assert!(message.contains("\"query\": \"rust\""));
        assert_eq!(message.matches("[redacted]").count(), 5);
        for secret in [
            "secret-api-value",
            "private-value",
            "client-value",
            "cookie-value",
            "private-key-value",
        ] {
            assert!(!message.contains(secret));
        }
    }

    #[tokio::test]
    async fn modern_agent_call_discovers_lists_authorizes_and_calls_on_one_transport() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}}
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "resultType": "complete",
                        "tools": [{
                            "name": "search",
                            "description": "Search papers",
                            "inputSchema": {"type": "object"}
                        }]
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": AGENT_TOOL_CALL_ID,
                    "result": {
                        "resultType": "complete",
                        "content": [{"type": "text", "text": "found"}]
                    }
                }))),
            ]),
            sent: Vec::new(),
        };
        let mut authorized = false;

        let result = connect_and_call_tool(
            &mut transport,
            "search",
            serde_json::json!({"query": "rust"}),
            || {
                authorized = true;
                Ok(())
            },
        )
        .await
        .unwrap();

        assert!(authorized);
        assert_eq!(result["content"][0]["text"], "found");
        assert_eq!(
            transport
                .sent
                .iter()
                .map(|message| message["method"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["server/discover", "tools/list", "tools/call"]
        );
        assert_eq!(transport.sent[2]["params"]["name"], "search");
        assert_eq!(transport.sent[2]["params"]["arguments"]["query"], "rust");
        assert!(transport.sent[2]["params"].get("_meta").is_some());
    }

    #[tokio::test]
    async fn legacy_agent_call_initializes_before_listing_and_calling() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {"code": -32601, "message": "Method not found"}
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "legacy", "version": "1"}
                    }
                }))),
                Ok(None),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "result": {"tools": [{"name": "fetch", "inputSchema": {"type": "object"}}]}
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": AGENT_TOOL_CALL_ID,
                    "result": {"content": [{"type": "text", "text": "legacy result"}]}
                }))),
            ]),
            sent: Vec::new(),
        };

        let result =
            connect_and_call_tool(&mut transport, "fetch", serde_json::json!({}), || Ok(()))
                .await
                .unwrap();

        assert_eq!(result["content"][0]["text"], "legacy result");
        assert_eq!(
            transport
                .sent
                .iter()
                .map(|message| message["method"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "server/discover",
                "initialize",
                "notifications/initialized",
                "tools/list",
                "tools/call"
            ]
        );
        assert!(transport.sent[4]["params"].get("_meta").is_none());
    }

    #[tokio::test]
    async fn agent_call_stops_when_the_server_changes_after_discovery() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}}
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "resultType": "complete",
                        "tools": [{"name": "search", "inputSchema": {"type": "object"}}]
                    }
                }))),
            ]),
            sent: Vec::new(),
        };

        let error = connect_and_call_tool(&mut transport, "search", serde_json::json!({}), || {
            Err(protocol_error(
                "MCP server 'papers' was disabled before the tool call",
            ))
        })
        .await
        .unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: MCP server 'papers' was disabled before the tool call."
        );
        assert_eq!(transport.sent.len(), 2);
    }

    #[tokio::test]
    async fn agent_call_rejects_a_tool_removed_after_the_schema_snapshot() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}}
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {"resultType": "complete", "tools": []}
                }))),
            ]),
            sent: Vec::new(),
        };

        let error = connect_and_call_tool(
            &mut transport,
            "removed_tool",
            serde_json::json!({}),
            || Ok(()),
        )
        .await
        .unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: tool 'removed_tool' is no longer available from the configured server."
        );
        assert_eq!(transport.sent.len(), 2);
    }

    #[tokio::test]
    async fn modern_agent_call_requires_a_complete_final_result() {
        let cases = [
            (
                serde_json::json!({"content": []}),
                "MCP protocol error: tools/call returned no result type.",
            ),
            (
                serde_json::json!({"resultType": "input_required"}),
                "MCP protocol error: tools/call requested unsupported multi-round-trip input.",
            ),
            (
                serde_json::json!({"resultType": "future_type"}),
                "MCP protocol error: tools/call returned an unsupported result type.",
            ),
        ];

        for (result, expected) in cases {
            let mut transport = FakeTransport {
                replies: VecDeque::from([Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": AGENT_TOOL_CALL_ID,
                    "result": result
                })))]),
                sent: Vec::new(),
            };

            let error = call_tool(
                &mut transport,
                "search",
                serde_json::json!({}),
                true,
                BTreeMap::new(),
            )
            .await
            .unwrap_err();

            assert_eq!(error.to_string(), expected);
        }
    }

    #[tokio::test]
    async fn successful_validation_reports_every_tool() {
        let result = validate_with(&stdio_server("search-server"), |_| async {
            Ok(vec![
                McpServerTool {
                    name: "search".into(),
                    description: Some("Search papers".into()),
                    input_schema: serde_json::json!({"type": "object"}),
                },
                McpServerTool {
                    name: "fetch".into(),
                    description: None,
                    input_schema: serde_json::json!({"type": "object"}),
                },
            ])
        })
        .await;

        assert_eq!(result.status, McpServerValidationStatus::Connected);
        assert_eq!(result.tool_count, 2);
        assert_eq!(result.tools[0].name, "search");
        assert_eq!(result.tools[1].name, "fetch");
        assert!(result.error.is_none());
    }

    #[tokio::test]
    async fn explicit_validation_checks_a_disabled_server() {
        let mut server = stdio_server("search-server");
        server.enabled = false;

        let result = validate_with(&server, |_| async {
            Ok(vec![McpServerTool {
                name: "disabled_search".into(),
                description: None,
                input_schema: serde_json::json!({"type": "object"}),
            }])
        })
        .await;

        assert_eq!(result.status, McpServerValidationStatus::Connected);
        assert_eq!(result.tools[0].name, "disabled_search");
    }

    #[tokio::test]
    async fn failed_validation_reports_a_precise_command_error() {
        let result = validate_with(&stdio_server("missing-mcp-server"), |_| async {
            Err(McpConnectionError::CommandNotFound {
                command: "missing-mcp-server".into(),
            })
        })
        .await;

        assert_eq!(result.status, McpServerValidationStatus::Error);
        assert_eq!(result.tool_count, 0);
        assert!(result.tools.is_empty());
        assert_eq!(
            result.error.as_deref(),
            Some("Could not start 'missing-mcp-server': command not found.")
        );
    }

    #[test]
    fn validation_redaction_is_single_pass_and_prefers_longer_values() {
        let mut server = stdio_server("search-server");
        {
            let McpServerTransport::Stdio { env, .. } = &mut server.transport else {
                unreachable!();
            };
            for index in 0..MAX_MAP_ENTRIES {
                env.insert(format!("TOKEN_{index}"), "e".into());
            }
        }

        let repeated = redact_server_values(&server, "eeee".into());

        assert_eq!(repeated, "[stored value]".repeat(4));

        let McpServerTransport::Stdio { env, .. } = &mut server.transport else {
            unreachable!();
        };
        env.clear();
        env.insert("SHORT".into(), "secret".into());
        env.insert("LONG".into(), "secret-token".into());

        let overlapping = redact_server_values(&server, "auth secret-token".into());

        assert_eq!(overlapping, "auth [stored value]");
    }

    #[test]
    fn transport_failures_have_human_readable_messages() {
        let cases = [
            (
                McpConnectionError::ConnectionRefused,
                "Could not connect to the remote MCP server: connection refused.",
            ),
            (
                McpConnectionError::Timeout,
                "MCP validation timed out after 10 seconds.",
            ),
            (
                McpConnectionError::Protocol {
                    detail: "tools/list returned no tools array".into(),
                },
                "MCP protocol error: tools/list returned no tools array.",
            ),
        ];

        for (error, expected) in cases {
            assert_eq!(error.to_string(), expected);
        }
    }

    #[tokio::test]
    async fn protocol_initializes_and_collects_every_tools_page() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {"code": -32601, "message": "Method not found"}
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "test", "version": "1"}
                    }
                }))),
                Ok(None),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "result": {
                        "tools": [{"name": "search", "description": "Search papers", "inputSchema": {"type": "object"}}],
                        "nextCursor": "page-2"
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 4,
                    "result": {
                        "tools": [{"name": "fetch", "inputSchema": {"type": "object"}}]
                    }
                }))),
            ]),
            sent: Vec::new(),
        };

        let tools = connect_and_list_tools(&mut transport).await.unwrap();

        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            vec!["search", "fetch"]
        );
        assert_eq!(transport.sent[0]["method"], "server/discover");
        assert_eq!(transport.sent[1]["method"], "initialize");
        assert_eq!(transport.sent[2]["method"], "notifications/initialized");
        assert_eq!(transport.sent[3]["method"], "tools/list");
        assert_eq!(transport.sent[4]["params"]["cursor"], "page-2");
    }

    #[tokio::test]
    async fn modern_protocol_discovers_and_lists_without_initializing() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}},
                        "_meta": {
                            "io.modelcontextprotocol/serverInfo": {
                                "name": "modern-test",
                                "version": "1"
                            }
                        }
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "resultType": "complete",
                        "tools": [{"name": "modern_search", "inputSchema": {"type": "object"}}],
                        "ttlMs": 60_000,
                        "cacheScope": "private"
                    }
                }))),
            ]),
            sent: Vec::new(),
        };

        let tools = connect_and_list_tools(&mut transport).await.unwrap();

        assert_eq!(tools[0].name, "modern_search");
        assert_eq!(transport.sent.len(), 2);
        assert_eq!(transport.sent[0]["method"], "server/discover");
        assert_eq!(transport.sent[1]["method"], "tools/list");
        assert_eq!(
            transport.sent[1]["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"],
            "2026-07-28"
        );
    }

    #[tokio::test]
    async fn modern_http_listing_excludes_only_tools_with_invalid_header_extensions() {
        let mut transport = ModernHttpFakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}}
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "resultType": "complete",
                        "tools": [
                            {
                                "name": "valid",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "region": {"type": "string", "x-mcp-header": "Region"}
                                    }
                                }
                            },
                            {
                                "name": "injected",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "region": {"type": "string", "x-mcp-header": "Bad\r\nHeader"}
                                    }
                                }
                            },
                            {
                                "name": "composed",
                                "inputSchema": {
                                    "type": "object",
                                    "oneOf": [{
                                        "properties": {
                                            "region": {"type": "string", "x-mcp-header": "Region"}
                                        }
                                    }]
                                }
                            }
                        ]
                    }
                }))),
            ]),
            sent: Vec::new(),
            headers: Vec::new(),
        };

        let tools = connect_and_list_tools(&mut transport).await.unwrap();

        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            vec!["valid"]
        );
    }

    #[tokio::test]
    async fn validation_rejects_a_tool_without_an_object_input_schema() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}}
                    }
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "resultType": "complete",
                        "tools": [{"name": "broken", "inputSchema": "not-an-object"}]
                    }
                }))),
            ]),
            sent: Vec::new(),
        };

        let error = connect_and_list_tools(&mut transport).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: tools/list returned tool 'broken' without an object input schema."
        );
    }

    #[tokio::test]
    async fn legacy_protocol_rejects_an_unknown_negotiated_version() {
        let mut transport = FakeTransport {
            replies: VecDeque::from([
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {"code": -32601, "message": "Method not found"}
                }))),
                Ok(Some(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "protocolVersion": "2099-01-01",
                        "capabilities": {},
                        "serverInfo": {"name": "future-test", "version": "1"}
                    }
                }))),
            ]),
            sent: Vec::new(),
        };

        let error = connect_and_list_tools(&mut transport).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: initialize returned unsupported protocol version '2099-01-01'."
        );
    }

    #[test]
    fn rpc_responses_require_json_rpc_2() {
        let response = serde_json::json!({
            "jsonrpc": "1.0",
            "id": 7,
            "result": {"tools": []}
        });

        let error = rpc_result(&response, 7, "tools/list").unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: tools/list returned an invalid JSON-RPC version."
        );
    }

    #[tokio::test]
    async fn validation_bounds_rpc_server_messages() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": {"code": -32603, "message": "x".repeat(10_000)}
        });
        let error = rpc_result(&response, 7, "tools/list").unwrap_err();

        let validation =
            validate_with(&stdio_server("search-server"), |_| async { Err(error) }).await;
        let message = validation.error.unwrap();

        assert!(message.starts_with("MCP protocol error: tools/list failed: "));
        assert!(message.ends_with("..."));
        assert_eq!(message.chars().count(), 515);
    }

    #[test]
    fn sse_parser_ignores_notifications_and_returns_the_matching_response() {
        let source = concat!(
            ": keepalive\n\n",
            "event: message\n",
            "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n",
            "event: message\n",
            "data: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"tools\":[]}}\n\n"
        );

        let response = parse_sse_response(source, 7).unwrap();

        assert_eq!(response["id"], 7);
        assert_eq!(response["result"]["tools"], serde_json::json!([]));
    }

    #[test]
    fn sse_decoder_handles_split_utf8_and_event_boundaries() {
        let source = concat!(
            "event: message\r\n",
            "data: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"tools\":[{\"name\":\"search\",\"description\":\"café\"}]}}\r\n\r\n"
        )
        .as_bytes();
        let accented = source
            .windows(2)
            .position(|window| window == "é".as_bytes())
            .unwrap();
        let delimiter = source.len() - 4;
        let mut decoder = SseDecoder::default();

        assert!(decoder.push(&source[..accented + 1], 7).unwrap().is_none());
        assert!(decoder
            .push(&source[accented + 1..delimiter + 2], 7)
            .unwrap()
            .is_none());
        let response = decoder.push(&source[delimiter + 2..], 7).unwrap().unwrap();

        assert_eq!(response["result"]["tools"][0]["description"], "café");
    }

    #[test]
    fn sse_decoder_rejects_a_response_with_the_wrong_id() {
        let source = "data: {\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{}}\n\n";

        let error = parse_sse_response(source, 7).unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: server returned a response with the wrong id."
        );
    }

    #[test]
    fn sse_decoder_accepts_bare_carriage_return_line_endings() {
        let source = concat!(
            "event: message\r",
            "data: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"tools\":[]}}\r\r"
        );

        let response = parse_sse_response(source, 7).unwrap();

        assert_eq!(response["result"]["tools"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn stdio_validation_names_a_missing_command() {
        let server = stdio_server("oleafly-command-that-does-not-exist");

        let error = connect_server(server).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "Could not start 'oleafly-command-that-does-not-exist': command not found."
        );
    }

    #[tokio::test]
    async fn stdio_validation_connects_and_lists_tools() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='server/discover'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}})+'\\n');}",
            "if(message.method==='initialize'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'stdio-test',version:'1'}}})+'\\n');}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'local_search',description:'Search locally',inputSchema:{type:'object'}}]}})+'\\n');}",
            "});"
        );
        let server = McpServerConfig {
            name: "stdio-search".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let tools = connect_server(server).await.unwrap();

        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "local_search");
        assert_eq!(tools[0].description.as_deref(), Some("Search locally"));
    }

    #[tokio::test]
    async fn stdio_validation_rejects_a_response_with_the_wrong_id() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id+1,result:{}})+'\\n');",
            "});"
        );
        let server = McpServerConfig {
            name: "wrong-id".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: server returned a response with the wrong id."
        );
    }

    #[tokio::test]
    async fn stdio_modern_version_errors_do_not_fall_back_to_legacy() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='server/discover'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{resultType:'complete',supportedVersions:['2027-01-01'],capabilities:{}}})+'\\n');}",
            "if(message.method==='initialize'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fallback',version:'1'}}})+'\\n');}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'should_not_run'}]}})+'\\n');}",
            "});"
        );
        let server = McpServerConfig {
            name: "modern-version-error".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: server supports protocol versions 2027-01-01, not 2026-07-28."
        );
    }

    #[tokio::test]
    async fn stdio_validation_allows_a_slow_modern_cold_start() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='server/discover'){setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}}})+'\\n'),2100);}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{resultType:'complete',tools:[{name:'slow_stdio_search',inputSchema:{type:'object'}}]}})+'\\n');}",
            "});"
        );
        let server = McpServerConfig {
            name: "slow-stdio".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let tools = connect_server(server).await.unwrap();

        assert_eq!(tools[0].name, "slow_stdio_search");
    }

    #[tokio::test]
    async fn stdio_validation_closes_stdin_before_forcing_shutdown() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("stdin-closed");
        let script = concat!(
            "const fs=require('node:fs');",
            "const readline=require('node:readline');",
            "const marker=process.argv[1];",
            "const lines=readline.createInterface({input:process.stdin});",
            "process.stdin.on('end',()=>fs.writeFileSync(marker,'closed'));",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='server/discover'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}}})+'\\n');}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{resultType:'complete',tools:[{name:'graceful',inputSchema:{type:'object'}}]}})+'\\n');}",
            "});"
        );
        let server = McpServerConfig {
            name: "graceful-stdio".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into(), marker.display().to_string()],
                env: BTreeMap::new(),
            },
        };

        let tools = connect_server(server).await.unwrap();

        assert_eq!(tools[0].name, "graceful");
        assert_eq!(std::fs::read_to_string(marker).unwrap(), "closed");
    }

    #[tokio::test]
    async fn stdio_validation_restarts_a_legacy_server_that_exits_on_discovery() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='server/discover'){process.exit(0);}",
            "if(message.method==='initialize'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'strict-legacy',version:'1'}}})+'\\n');}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'legacy_search',inputSchema:{type:'object'}}]}})+'\\n');}",
            "});"
        );
        let server = McpServerConfig {
            name: "strict-legacy".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let tools = connect_server(server).await.unwrap();

        assert_eq!(tools[0].name, "legacy_search");
    }

    #[tokio::test]
    async fn stdio_listing_restarts_a_legacy_server_that_ignores_discovery() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='initialize'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'silent-legacy',version:'1'}}})+'\\n');}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'silent_search',inputSchema:{type:'object'}}]}})+'\\n');}",
            "});"
        );

        let tools = connect_stdio_server_with_probe_timeout(
            "node",
            &["-e".into(), script.into()],
            &BTreeMap::new(),
            Duration::from_millis(50),
        )
        .await
        .unwrap();

        assert_eq!(tools[0].name, "silent_search");
    }

    #[tokio::test]
    async fn stdio_call_restarts_a_legacy_server_that_ignores_discovery() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='initialize'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'silent-legacy',version:'1'}}})+'\\n');}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'silent_search',inputSchema:{type:'object'}}]}})+'\\n');}",
            "if(message.method==='tools/call'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'called'}]}})+'\\n');}",
            "});"
        );

        let result = connect_stdio_server_and_call_with_probe_timeout(
            "node",
            &["-e".into(), script.into()],
            &BTreeMap::new(),
            "silent_search",
            serde_json::json!({}),
            || Ok(()),
            Duration::from_millis(50),
        )
        .await
        .unwrap();

        assert_eq!(result["content"][0]["text"], "called");
    }

    #[tokio::test]
    async fn stdio_validation_surfaces_a_bounded_stderr_excerpt() {
        let script = concat!(
            "process.stdin.once('data',()=>{",
            "process.stderr.write('package search-server is not installed\\n');",
            "process.exit(1);",
            "});"
        );
        let server = McpServerConfig {
            name: "stdio-error".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        assert!(error
            .to_string()
            .contains("package search-server is not installed"));
    }

    #[tokio::test]
    async fn stdio_validation_redacts_configured_values_echoed_on_stderr() {
        let secret = "stdio-secret-that-must-not-leak".repeat(64);
        let script = concat!(
            "process.stdin.once('data',()=>{",
            "process.stderr.write('auth failed for '+process.env.MCP_SECRET);",
            "process.exit(1);",
            "});"
        );
        let server = McpServerConfig {
            name: "stdio-secret-error".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::from([("MCP_SECRET".into(), secret.clone())]),
            },
        };

        let validation = validate_with(&server, connect_server).await;
        let message = validation.error.unwrap();

        assert!(!message.contains(&secret));
        assert!(message.contains("auth failed for [stored value]"));
    }

    #[tokio::test]
    async fn stdio_validation_redacts_and_bounds_server_controlled_tool_metadata() {
        let secret = "stdio-secret-that-must-not-leak";
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='server/discover'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}}})+'\\n');}",
            "if(message.method==='tools/list'){const secret=process.env.MCP_SECRET;process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{resultType:'complete',tools:[{name:'local_'+secret,description:'x'.repeat(520)+secret,inputSchema:{type:'object'}}]}})+'\\n');}",
            "});"
        );
        let server = McpServerConfig {
            name: "stdio-secret-tools".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::from([("MCP_SECRET".into(), secret.into())]),
            },
        };

        let validation = validate_with(&server, connect_server).await;
        let tool = &validation.tools[0];

        assert_eq!(validation.status, McpServerValidationStatus::Connected);
        assert_eq!(validation.tool_count, 1);
        assert_eq!(tool.name, "local_[stored value]");
        assert_eq!(
            tool.description.as_deref(),
            Some(format!("{}...", "x".repeat(512)).as_str())
        );
        assert!(!tool.name.contains(secret));
        assert!(!tool.description.as_deref().unwrap().contains(secret));
    }

    #[tokio::test]
    async fn stdio_validation_drains_verbose_stderr_while_listing_tools() {
        let script = concat!(
            "const readline=require('node:readline');",
            "const lines=readline.createInterface({input:process.stdin});",
            "lines.on('line',(line)=>{",
            "const message=JSON.parse(line);",
            "if(message.method==='server/discover'){process.stderr.write('x'.repeat(100000),()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}})+'\\n'));}",
            "if(message.method==='initialize'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'verbose-test',version:'1'}}})+'\\n');}",
            "if(message.method==='tools/list'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'verbose_search',inputSchema:{type:'object'}}]}})+'\\n');}",
            "});"
        );
        let server = McpServerConfig {
            name: "verbose-server".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let tools = connect_server(server).await.unwrap();

        assert_eq!(tools[0].name, "verbose_search");
    }

    #[tokio::test]
    async fn stdio_validation_rejects_an_oversized_line_without_waiting_for_newline() {
        let script = concat!(
            "process.stdin.once('data',()=>{",
            "process.stdout.write('x'.repeat(2*1024*1024+1));",
            "});"
        );
        let server = McpServerConfig {
            name: "oversized-server".into(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".into(),
                args: vec!["-e".into(), script.into()],
                env: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "MCP protocol error: server response exceeded the 2 MiB limit."
        );
    }

    #[tokio::test]
    async fn failed_add_and_reenable_do_not_change_persisted_servers() {
        let (_directory, repository) = disk_repository();
        let failed = add_server_with(&repository, stdio_server("missing"), |_| async {
            Err(McpConnectionError::CommandNotFound {
                command: "missing".into(),
            })
        })
        .await;
        assert!(failed.is_err());
        assert!(repository.load().unwrap().mcp_servers.is_empty());

        add_server_with(&repository, stdio_server("working"), good_connect)
            .await
            .unwrap();
        set_server_enabled_with(&repository, "local-search", false, good_connect)
            .await
            .unwrap();
        let failed = set_server_enabled_with(&repository, "local-search", true, |_| async {
            Err(McpConnectionError::Protocol {
                detail: "tools/list failed".into(),
            })
        })
        .await;
        assert!(failed.is_err());
        assert!(!repository.load().unwrap().mcp_servers[0].enabled);
    }

    #[tokio::test]
    async fn enabling_a_persisted_server_validates_its_configuration_before_connecting() {
        let (_directory, repository) = disk_repository();
        let mut server = remote_server("insecure-persisted");
        server.enabled = false;
        let McpServerTransport::Remote { url, .. } = &mut server.transport else {
            unreachable!();
        };
        *url = "http://mcp.example.test/tools".into();
        repository
            .update(|config| {
                config.mcp_servers = vec![server];
                Ok(())
            })
            .unwrap();

        let result = set_server_enabled_with(&repository, "insecure-persisted", true, |_| async {
            panic!("invalid configuration reached the connect boundary")
        })
        .await;

        assert_eq!(
            result.unwrap_err(),
            "Remote URL must use HTTPS unless it points to localhost."
        );
        assert!(!repository.load().unwrap().mcp_servers[0].enabled);
    }

    #[tokio::test]
    async fn adding_more_than_the_server_limit_is_rejected_before_validation() {
        let (_directory, repository) = disk_repository();
        let config = AppConfig {
            mcp_servers: (0..MAX_MCP_SERVERS)
                .map(|index| {
                    let mut server = stdio_server("search-server");
                    server.name = format!("server-{index}");
                    server
                })
                .collect(),
            ..AppConfig::default()
        };
        repository
            .update(|stored| {
                *stored = config;
                Ok(())
            })
            .unwrap();

        let result =
            add_server_with(&repository, remote_server("one-too-many"), good_connect).await;

        assert_eq!(
            result.unwrap_err(),
            "Oleafly supports up to 64 MCP servers."
        );
        assert_eq!(
            repository.load().unwrap().mcp_servers.len(),
            MAX_MCP_SERVERS
        );
    }

    #[test]
    fn validation_admission_rejects_work_above_the_concurrency_limit() {
        let state = McpClientState::default();
        let permits = (0..MAX_CONCURRENT_VALIDATIONS)
            .map(|_| acquire_validation_slot(&state).unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            acquire_validation_slot(&state).unwrap_err(),
            "MCP validation is busy. Try again in a moment."
        );

        drop(permits);
        assert!(acquire_validation_slot(&state).is_ok());
    }

    #[tokio::test]
    async fn remote_validation_uses_headers_session_and_sse_tools() {
        use axum::extract::State;
        use axum::http::{HeaderMap, HeaderValue, StatusCode};
        use axum::response::{IntoResponse, Response};
        use axum::routing::post;
        use axum::{Json, Router};
        use std::sync::{Arc, Mutex};

        #[derive(Clone, Default)]
        struct TestState {
            calls: Arc<Mutex<Vec<(serde_json::Value, HeaderMap)>>>,
            deletes: Arc<Mutex<Vec<HeaderMap>>>,
        }

        async fn handler(
            State(state): State<TestState>,
            headers: HeaderMap,
            Json(message): Json<serde_json::Value>,
        ) -> Response {
            state
                .calls
                .lock()
                .unwrap()
                .push((message.clone(), headers.clone()));
            match message["method"].as_str() {
                Some("server/discover") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {"code": -32601, "message": "Method not found"}
                }))
                .into_response(),
                Some("initialize") => {
                    let mut response_headers = HeaderMap::new();
                    response_headers.insert(
                        "mcp-session-id",
                        HeaderValue::from_static("validation-session"),
                    );
                    (
                        StatusCode::OK,
                        response_headers,
                        Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": 2,
                            "result": {
                                "protocolVersion": "2025-06-18",
                                "capabilities": {"tools": {}},
                                "serverInfo": {"name": "remote-test", "version": "1"}
                            }
                        })),
                    )
                        .into_response()
                }
                Some("notifications/initialized") => StatusCode::ACCEPTED.into_response(),
                Some("tools/list") => (
                    StatusCode::OK,
                    [("content-type", "text/event-stream")],
                    concat!(
                        "event: message\n",
                        "data: {\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"tools\":[{\"name\":\"remote_search\",\"description\":\"Search remotely\",\"inputSchema\":{\"type\":\"object\"}}]}}\n\n"
                    ),
                )
                    .into_response(),
                _ => StatusCode::BAD_REQUEST.into_response(),
            }
        }

        async fn delete_handler(State(state): State<TestState>, headers: HeaderMap) -> StatusCode {
            state.deletes.lock().unwrap().push(headers);
            StatusCode::NO_CONTENT
        }

        let state = TestState::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/mcp", post(handler).delete(delete_handler))
            .with_state(state.clone());
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "remote-search".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::from([("X-Test-Key".into(), "ready".into())]),
            },
        };

        let tools = connect_server(server).await.unwrap();

        serve.abort();
        assert_eq!(tools[0].name, "remote_search");
        let calls = state.calls.lock().unwrap();
        assert_eq!(calls.len(), 4);
        assert_eq!(calls[0].1["x-test-key"], "ready");
        assert!(calls[0].1.get("mcp-session-id").is_none());
        assert_eq!(calls[0].1["mcp-protocol-version"], "2026-07-28");
        assert_eq!(calls[0].1["mcp-method"], "server/discover");
        assert!(calls[1].1.get("mcp-session-id").is_none());
        assert_eq!(calls[2].1["mcp-session-id"], "validation-session");
        assert_eq!(calls[3].1["mcp-protocol-version"], "2025-06-18");
        let deletes = state.deletes.lock().unwrap();
        assert_eq!(deletes.len(), 1);
        assert_eq!(deletes[0]["mcp-session-id"], "validation-session");
        assert_eq!(deletes[0]["mcp-protocol-version"], "2025-06-18");
    }

    #[tokio::test]
    async fn remote_validation_uses_modern_metadata_and_request_headers() {
        use axum::extract::State;
        use axum::http::HeaderMap;
        use axum::routing::post;
        use axum::{Json, Router};
        use std::sync::{Arc, Mutex};

        #[derive(Clone, Default)]
        struct TestState {
            calls: Arc<Mutex<Vec<(serde_json::Value, HeaderMap)>>>,
        }

        async fn handler(
            State(state): State<TestState>,
            headers: HeaderMap,
            Json(message): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            state.calls.lock().unwrap().push((message.clone(), headers));
            match message["method"].as_str() {
                Some("server/discover") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}},
                        "_meta": {
                            "io.modelcontextprotocol/serverInfo": {
                                "name": "modern-remote",
                                "version": "1"
                            }
                        }
                    }
                })),
                Some("tools/list") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "resultType": "complete",
                        "tools": [{"name": "modern_remote_search", "inputSchema": {"type": "object"}}]
                    }
                })),
                _ => unreachable!(),
            }
        }

        let state = TestState::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/mcp", post(handler))
            .with_state(state.clone());
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "modern-remote".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };

        let tools = connect_server(server).await.unwrap();

        serve.abort();
        assert_eq!(tools[0].name, "modern_remote_search");
        let calls = state.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].1["mcp-protocol-version"], "2026-07-28");
        assert_eq!(calls[0].1["mcp-method"], "server/discover");
        assert_eq!(calls[1].1["mcp-method"], "tools/list");
        assert!(calls[0].1.get("mcp-session-id").is_none());
        assert_eq!(
            calls[1].0["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"],
            "2026-07-28"
        );
    }

    #[tokio::test]
    async fn modern_remote_tool_call_mirrors_name_and_annotated_arguments() {
        use axum::extract::State;
        use axum::http::HeaderMap;
        use axum::routing::post;
        use axum::{Json, Router};
        use std::sync::{Arc, Mutex};

        #[derive(Clone, Default)]
        struct TestState {
            calls: Arc<Mutex<Vec<(serde_json::Value, HeaderMap)>>>,
        }

        async fn handler(
            State(state): State<TestState>,
            headers: HeaderMap,
            Json(message): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            state.calls.lock().unwrap().push((message.clone(), headers));
            match message["method"].as_str() {
                Some("server/discover") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}}
                    }
                })),
                Some("tools/list") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "resultType": "complete",
                        "tools": [{
                            "name": "weather 世界",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "region": {"type": "string", "x-mcp-header": "Region"},
                                    "context": {
                                        "type": "object",
                                        "properties": {
                                            "count": {"type": "integer", "x-mcp-header": "Count"},
                                            "enabled": {"type": "boolean", "x-mcp-header": "Enabled"}
                                        }
                                    }
                                }
                            }
                        }]
                    }
                })),
                Some("tools/call") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "resultType": "complete",
                        "content": [{"type": "text", "text": "done"}]
                    }
                })),
                _ => unreachable!(),
            }
        }

        let state = TestState::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/mcp", post(handler))
            .with_state(state.clone());
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "modern-call".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };

        let result = connect_server_and_call(
            server,
            "weather 世界",
            serde_json::json!({
                "region": "Hello, 世界",
                "context": {"count": 42, "enabled": true}
            }),
            || Ok(()),
        )
        .await
        .unwrap();

        serve.abort();
        assert_eq!(result["content"][0]["text"], "done");
        let calls = state.calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        let (body, headers) = &calls[2];
        assert_eq!(headers["mcp-protocol-version"], "2026-07-28");
        assert_eq!(headers["mcp-method"], "tools/call");
        assert_eq!(headers["mcp-name"], "=?base64?d2VhdGhlciDkuJbnlYw=?=");
        assert_eq!(
            headers["mcp-param-region"],
            "=?base64?SGVsbG8sIOS4lueVjA==?="
        );
        assert_eq!(headers["mcp-param-count"], "42");
        assert_eq!(headers["mcp-param-enabled"], "true");
        assert_eq!(body["params"]["name"], "weather 世界");
        assert_eq!(body["params"]["arguments"]["context"]["count"], 42);
    }

    #[tokio::test]
    async fn remote_tool_transport_uses_a_call_specific_timeout_and_error() {
        use axum::routing::post;
        use axum::{Json, Router};

        async fn handler(Json(message): Json<serde_json::Value>) -> Json<serde_json::Value> {
            tokio::time::sleep(Duration::from_millis(75)).await;
            Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {"resultType": "complete"}
            }))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/mcp", post(handler));
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let url = format!("http://{address}/mcp");
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "server/discover",
            "params": {"_meta": modern_request_metadata()}
        });

        let mut validation = RemoteTransport::new_with_timeout(
            &url,
            &BTreeMap::new(),
            Duration::from_millis(20),
            McpConnectionError::Timeout,
        )
        .unwrap();
        validation
            .set_protocol_version(Some(MODERN_PROTOCOL_VERSION))
            .unwrap();
        let validation_error = validation.send(message.clone()).await.unwrap_err();

        let mut execution = RemoteTransport::new_with_timeout(
            &url,
            &BTreeMap::new(),
            Duration::from_millis(250),
            McpConnectionError::ToolTimeout,
        )
        .unwrap();
        execution
            .set_protocol_version(Some(MODERN_PROTOCOL_VERSION))
            .unwrap();
        let response = execution.send(message).await.unwrap().unwrap();

        serve.abort();
        assert_eq!(
            validation_error.to_string(),
            "MCP validation timed out after 10 seconds."
        );
        assert_eq!(response["result"]["resultType"], "complete");
        assert_eq!(
            McpConnectionError::ToolTimeout.to_string(),
            "MCP tool call timed out after 15 seconds."
        );
    }

    #[tokio::test]
    async fn successful_tool_call_is_not_reclassified_when_cleanup_crosses_deadline() {
        use axum::extract::State;
        use axum::http::{HeaderMap, HeaderValue, StatusCode};
        use axum::response::{IntoResponse, Response};
        use axum::routing::post;
        use axum::{Json, Router};
        use std::sync::{Arc, Mutex};

        #[derive(Clone, Default)]
        struct TestState {
            methods: Arc<Mutex<Vec<String>>>,
        }

        async fn handler(
            State(state): State<TestState>,
            Json(message): Json<serde_json::Value>,
        ) -> Response {
            let method = message["method"].as_str().unwrap().to_string();
            state.methods.lock().unwrap().push(method.clone());
            match method.as_str() {
                "server/discover" => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": -32601, "message": "Method not found"}
                }))
                .into_response(),
                "initialize" => {
                    let mut headers = HeaderMap::new();
                    headers.insert("mcp-session-id", HeaderValue::from_static("slow-cleanup"));
                    (
                        headers,
                        Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": message["id"],
                            "result": {
                                "protocolVersion": "2025-06-18",
                                "capabilities": {"tools": {}},
                                "serverInfo": {"name": "slow-cleanup", "version": "1"}
                            }
                        })),
                    )
                        .into_response()
                }
                "notifications/initialized" => StatusCode::ACCEPTED.into_response(),
                "tools/list" => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {"tools": [{"name": "publish", "inputSchema": {"type": "object"}}]}
                }))
                .into_response(),
                "tools/call" => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": message["id"],
                        "result": {"content": [{"type": "text", "text": "published"}]}
                    }))
                    .into_response()
                }
                _ => StatusCode::BAD_REQUEST.into_response(),
            }
        }

        async fn delete_handler() -> StatusCode {
            tokio::time::sleep(Duration::from_millis(450)).await;
            StatusCode::NO_CONTENT
        }

        let state = TestState::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/mcp", post(handler).delete(delete_handler))
            .with_state(state.clone());
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "slow-cleanup".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };
        let started = tokio::time::Instant::now();
        let deadline = started + Duration::from_millis(500);

        let result = connect_server_and_call_until(
            server,
            "publish",
            serde_json::json!({}),
            || Ok(()),
            deadline,
        )
        .await
        .unwrap();

        serve.abort();
        assert_eq!(result["content"][0]["text"], "published");
        assert!(tokio::time::Instant::now() > deadline);
        assert_eq!(
            state.methods.lock().unwrap().last().map(String::as_str),
            Some("tools/call")
        );
    }

    #[tokio::test]
    async fn remote_validation_allows_slow_modern_discovery_within_the_total_timeout() {
        use axum::routing::post;
        use axum::{Json, Router};
        use std::sync::{Arc, Mutex};

        async fn handler(
            axum::extract::State(methods): axum::extract::State<Arc<Mutex<Vec<String>>>>,
            Json(message): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            let method = message["method"].as_str().unwrap().to_string();
            methods.lock().unwrap().push(method.clone());
            match method.as_str() {
                "server/discover" => {
                    tokio::time::sleep(Duration::from_millis(2_100)).await;
                    Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": message["id"],
                        "result": {
                            "resultType": "complete",
                            "supportedVersions": ["2026-07-28"],
                            "capabilities": {"tools": {}}
                        }
                    }))
                }
                "tools/list" => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {"resultType": "complete", "tools": [{"name": "slow_search", "inputSchema": {"type": "object"}}]}
                })),
                _ => unreachable!(),
            }
        }

        let methods = Arc::new(Mutex::new(Vec::new()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/mcp", post(handler))
            .with_state(Arc::clone(&methods));
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "slow-modern".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };

        let tools = connect_server(server).await.unwrap();

        serve.abort();
        assert_eq!(tools[0].name, "slow_search");
        assert_eq!(
            *methods.lock().unwrap(),
            vec!["server/discover".to_string(), "tools/list".to_string()]
        );
    }

    #[tokio::test]
    async fn remote_validation_rejects_a_notification_response_body() {
        use axum::http::{HeaderMap, HeaderValue, StatusCode};
        use axum::response::{IntoResponse, Response};
        use axum::routing::post;
        use axum::{Json, Router};

        async fn handler(Json(message): Json<serde_json::Value>) -> Response {
            match message["method"].as_str() {
                Some("server/discover") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": -32601, "message": "Method not found"}
                }))
                .into_response(),
                Some("initialize") => {
                    let mut headers = HeaderMap::new();
                    headers.insert("mcp-session-id", HeaderValue::from_static("bad-notify"));
                    (
                        StatusCode::OK,
                        headers,
                        Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": message["id"],
                            "result": {
                                "protocolVersion": "2025-06-18",
                                "capabilities": {},
                                "serverInfo": {"name": "bad-notify", "version": "1"}
                            }
                        })),
                    )
                        .into_response()
                }
                Some("notifications/initialized") => (
                    StatusCode::ACCEPTED,
                    Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 99,
                        "result": {}
                    })),
                )
                    .into_response(),
                _ => StatusCode::BAD_REQUEST.into_response(),
            }
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/mcp", post(handler));
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "bad-notification".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        serve.abort();
        assert_eq!(
            error.to_string(),
            "MCP protocol error: notifications/initialized returned an unexpected response."
        );
    }

    #[tokio::test]
    async fn remote_validation_requires_202_for_notifications() {
        use axum::http::StatusCode;
        use axum::response::{IntoResponse, Response};
        use axum::routing::post;
        use axum::{Json, Router};

        async fn handler(Json(message): Json<serde_json::Value>) -> Response {
            match message["method"].as_str() {
                Some("server/discover") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": -32601, "message": "Method not found"}
                }))
                .into_response(),
                Some("initialize") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "serverInfo": {"name": "bad-notify-status", "version": "1"}
                    }
                }))
                .into_response(),
                Some("notifications/initialized") => StatusCode::OK.into_response(),
                _ => StatusCode::BAD_REQUEST.into_response(),
            }
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/mcp", post(handler));
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "bad-notification-status".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        serve.abort();
        assert_eq!(
            error.to_string(),
            "MCP protocol error: notifications/initialized returned HTTP 200 instead of 202 Accepted."
        );
    }

    #[tokio::test]
    async fn remote_validation_rejects_non_mcp_content_types() {
        use axum::http::StatusCode;
        use axum::routing::post;
        use axum::Router;

        async fn handler() -> (StatusCode, [(&'static str, &'static str); 1], &'static str) {
            (
                StatusCode::OK,
                [("content-type", "text/plain")],
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
            )
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/mcp", post(handler));
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "plain-text-server".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        serve.abort();
        assert_eq!(
            error.to_string(),
            "MCP protocol error: server/discover returned unsupported content type 'text/plain'."
        );
    }

    #[tokio::test]
    async fn remote_validation_redacts_configured_values_echoed_by_the_server() {
        use axum::http::HeaderMap;
        use axum::routing::post;
        use axum::{Json, Router};

        async fn handler(
            headers: HeaderMap,
            Json(message): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            match message["method"].as_str() {
                Some("server/discover") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": -32601, "message": "Method not found"}
                })),
                Some("initialize") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {
                        "code": -32603,
                        "message": format!("auth failed for {}", headers["authorization"].to_str().unwrap())
                    }
                })),
                _ => unreachable!(),
            }
        }

        let secret = format!("Bearer {}", "remote-secret-that-must-not-leak".repeat(64));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/mcp", post(handler));
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "remote-secret-error".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::from([("Authorization".into(), secret.clone())]),
            },
        };

        let validation = validate_with(&server, connect_server).await;
        let message = validation.error.unwrap();

        serve.abort();
        assert!(!message.contains(&secret));
        assert!(message.contains("auth failed for [stored value]"));
    }

    #[tokio::test]
    async fn remote_validation_redacts_and_bounds_server_controlled_tool_metadata() {
        use axum::http::HeaderMap;
        use axum::routing::post;
        use axum::{Json, Router};

        async fn handler(
            headers: HeaderMap,
            Json(message): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            match message["method"].as_str() {
                Some("server/discover") => Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "resultType": "complete",
                        "supportedVersions": ["2026-07-28"],
                        "capabilities": {"tools": {}}
                    }
                })),
                Some("tools/list") => {
                    let secret = headers["x-test-secret"].to_str().unwrap();
                    Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": message["id"],
                        "result": {
                            "resultType": "complete",
                            "tools": [{
                                "name": format!("remote_{secret}"),
                                "description": format!("{}{secret}", "y".repeat(520)),
                                "inputSchema": {"type": "object"}
                            }]
                        }
                    }))
                }
                _ => unreachable!(),
            }
        }

        let secret = "remote-secret-that-must-not-leak";
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/mcp", post(handler));
        let serve = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let server = McpServerConfig {
            name: "remote-secret-tools".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::from([("X-Test-Secret".into(), secret.into())]),
            },
        };

        let validation = validate_with(&server, connect_server).await;
        let tool = &validation.tools[0];

        serve.abort();
        assert_eq!(validation.status, McpServerValidationStatus::Connected);
        assert_eq!(validation.tool_count, 1);
        assert_eq!(tool.name, "remote_[stored value]");
        assert_eq!(
            tool.description.as_deref(),
            Some(format!("{}...", "y".repeat(512)).as_str())
        );
        assert!(!tool.name.contains(secret));
        assert!(!tool.description.as_deref().unwrap().contains(secret));
    }

    #[tokio::test]
    async fn remote_validation_reports_a_real_connection_refusal() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let server = McpServerConfig {
            name: "offline-remote".into(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::new(),
            },
        };

        let error = connect_server(server).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "Could not connect to the remote MCP server: connection refused."
        );
    }

    #[tokio::test]
    async fn server_crud_and_enable_state_persist_across_reloads() {
        let (_directory, repository) = disk_repository();

        add_server_with(&repository, stdio_server("search-server"), good_connect)
            .await
            .unwrap();
        assert_eq!(repository.load().unwrap().mcp_servers.len(), 1);

        edit_server_with(
            &repository,
            "local-search",
            remote_server("hosted-search"),
            good_connect,
        )
        .await
        .unwrap();
        let edited = repository.load().unwrap();
        assert_eq!(edited.mcp_servers[0].name, "hosted-search");
        assert!(matches!(
            edited.mcp_servers[0].transport,
            McpServerTransport::Remote { .. }
        ));

        set_server_enabled_with(&repository, "hosted-search", false, good_connect)
            .await
            .unwrap();
        assert!(!repository.load().unwrap().mcp_servers[0].enabled);

        set_server_enabled_with(&repository, "hosted-search", true, good_connect)
            .await
            .unwrap();
        assert!(repository.load().unwrap().mcp_servers[0].enabled);

        remove_server_with(&repository, "hosted-search").unwrap();
        assert!(repository.load().unwrap().mcp_servers.is_empty());
    }

    #[tokio::test]
    async fn a_server_added_during_validation_is_preserved() {
        let (_directory, repository) = disk_repository();
        let concurrent_path = repository.path.clone();

        add_server_with(
            &repository,
            stdio_server("search-server"),
            move |_| async move {
                let concurrent = DiskRepository {
                    path: concurrent_path,
                };
                concurrent
                    .update(|config| {
                        config.mcp_servers.push(remote_server("concurrent-search"));
                        Ok(())
                    })
                    .unwrap();
                Ok(vec![McpServerTool {
                    name: "search".into(),
                    description: None,
                    input_schema: serde_json::json!({"type": "object"}),
                }])
            },
        )
        .await
        .unwrap();

        let persisted = repository.load().unwrap();
        assert_eq!(persisted.mcp_servers.len(), 2);
        assert!(persisted
            .mcp_servers
            .iter()
            .any(|server| server.name == "concurrent-search"));
        assert!(persisted
            .mcp_servers
            .iter()
            .any(|server| server.name == "local-search"));
    }

    #[tokio::test]
    async fn an_edit_does_not_overwrite_a_server_changed_during_validation() {
        let (_directory, repository) = disk_repository();
        add_server_with(&repository, stdio_server("search-server"), good_connect)
            .await
            .unwrap();
        let concurrent_path = repository.path.clone();

        let result = edit_server_with(
            &repository,
            "local-search",
            remote_server("hosted-search"),
            move |_| async move {
                let concurrent = DiskRepository {
                    path: concurrent_path,
                };
                concurrent
                    .update(|config| {
                        let McpServerTransport::Stdio { command, .. } =
                            &mut config.mcp_servers[0].transport
                        else {
                            unreachable!();
                        };
                        *command = "newer-search-server".into();
                        Ok(())
                    })
                    .unwrap();
                Ok(vec![McpServerTool {
                    name: "search".into(),
                    description: None,
                    input_schema: serde_json::json!({"type": "object"}),
                }])
            },
        )
        .await;

        assert_eq!(
            result.unwrap_err(),
            "MCP server 'local-search' changed before this update was saved. Review its latest settings and try again."
        );
        let persisted = repository.load().unwrap();
        assert_eq!(persisted.mcp_servers[0].name, "local-search");
        let McpServerTransport::Stdio { command, .. } = &persisted.mcp_servers[0].transport else {
            unreachable!();
        };
        assert_eq!(command, "newer-search-server");
    }

    #[test]
    fn server_config_validation_rejects_unsafe_inputs() {
        let mut invalid_name = stdio_server("search-server");
        invalid_name.name = "../search".into();
        assert_eq!(
            normalize_server_config(invalid_name).unwrap_err(),
            "Server name can use letters, numbers, dots, hyphens, and underscores."
        );

        let mut empty_command = stdio_server(" ");
        assert_eq!(
            normalize_server_config(empty_command.clone()).unwrap_err(),
            "Command is required."
        );
        if let McpServerTransport::Stdio { env, .. } = &mut empty_command.transport {
            env.insert("BAD=KEY".into(), "value".into());
        }
        assert_eq!(
            normalize_server_config(empty_command).unwrap_err(),
            "Command is required."
        );

        let mut invalid_remote = remote_server("remote");
        if let McpServerTransport::Remote { url, .. } = &mut invalid_remote.transport {
            *url = "file:///tmp/mcp.sock".into();
        }
        assert_eq!(
            normalize_server_config(invalid_remote).unwrap_err(),
            "Remote URL must use http or https."
        );

        let mut insecure_remote = remote_server("insecure");
        if let McpServerTransport::Remote { url, .. } = &mut insecure_remote.transport {
            *url = "http://mcp.example.test/tools".into();
        }
        assert_eq!(
            normalize_server_config(insecure_remote).unwrap_err(),
            "Remote URL must use HTTPS unless it points to localhost."
        );

        let mut loopback_remote = remote_server("loopback");
        if let McpServerTransport::Remote { url, .. } = &mut loopback_remote.transport {
            *url = "http://127.0.0.1:8787/mcp".into();
        }
        assert!(normalize_server_config(loopback_remote).is_ok());

        let mut localhost_remote = remote_server("localhost");
        if let McpServerTransport::Remote { url, .. } = &mut localhost_remote.transport {
            *url = "http://localhost:8787/mcp".into();
        }
        assert!(normalize_server_config(localhost_remote).is_ok());

        let mut protected_header = remote_server("remote");
        if let McpServerTransport::Remote { headers, .. } = &mut protected_header.transport {
            headers.insert("MCP-Protocol-Version".into(), "wrong".into());
        }
        assert_eq!(
            normalize_server_config(protected_header).unwrap_err(),
            "Header 'MCP-Protocol-Version' is managed by Oleafly."
        );

        let mut mirrored_header = remote_server("remote");
        if let McpServerTransport::Remote { headers, .. } = &mut mirrored_header.transport {
            headers.insert("Mcp-Param-Region".into(), "forged".into());
        }
        assert_eq!(
            normalize_server_config(mirrored_header).unwrap_err(),
            "Header 'Mcp-Param-Region' is managed by Oleafly."
        );

        let mut reserved_secret = stdio_server("search-server");
        if let McpServerTransport::Stdio { env, .. } = &mut reserved_secret.transport {
            env.insert("TOKEN".into(), crate::config::REDACTED.into());
        }
        assert_eq!(
            normalize_server_config(reserved_secret).unwrap_err(),
            "Environment variable 'TOKEN' must be entered again."
        );

        let versioned_marker = format!("__stored__:v1:{}", "a".repeat(64));
        let mut supplied_stdio_reference = stdio_server("search-server");
        if let McpServerTransport::Stdio { env, .. } = &mut supplied_stdio_reference.transport {
            env.insert("TOKEN".into(), versioned_marker.clone());
        }
        assert_eq!(
            normalize_server_config_with_stored_values(supplied_stdio_reference, true).unwrap_err(),
            "Environment variable 'TOKEN' must be entered again."
        );

        let mut supplied_header_reference = remote_server("remote-reference");
        if let McpServerTransport::Remote { headers, .. } = &mut supplied_header_reference.transport
        {
            headers.insert("X-Token".into(), versioned_marker);
        }
        assert_eq!(
            normalize_server_config_with_stored_values(supplied_header_reference, true)
                .unwrap_err(),
            "Header 'X-Token' must be entered again."
        );
    }

    #[test]
    fn normalized_endpoints_can_reuse_stored_values() {
        let stored_remote = remote_server("hosted-search");
        let mut incoming_remote = remote_server("hosted-search");
        let McpServerTransport::Remote { url, headers } = &mut incoming_remote.transport else {
            unreachable!();
        };
        *url = "  https://mcp.example.test/mcp  ".into();
        headers.insert("Authorization".into(), crate::config::REDACTED.into());
        let mut incoming_remote =
            normalize_server_config_with_stored_values(incoming_remote, true).unwrap();

        crate::config::restore_mcp_server_secret_markers(&mut incoming_remote, &stored_remote)
            .unwrap();

        assert_eq!(incoming_remote, stored_remote);

        let mut stored_stdio = stdio_server("node");
        let McpServerTransport::Stdio { env, .. } = &mut stored_stdio.transport else {
            unreachable!();
        };
        env.insert("SEARCH_TOKEN".into(), "stdio-secret".into());
        let mut incoming_stdio = stdio_server(" node ");
        let McpServerTransport::Stdio { env, .. } = &mut incoming_stdio.transport else {
            unreachable!();
        };
        env.insert("SEARCH_TOKEN".into(), crate::config::REDACTED.into());
        let mut incoming_stdio =
            normalize_server_config_with_stored_values(incoming_stdio, true).unwrap();

        crate::config::restore_mcp_server_secret_markers(&mut incoming_stdio, &stored_stdio)
            .unwrap();

        assert_eq!(incoming_stdio, stored_stdio);
    }

    #[test]
    fn management_commands_are_limited_to_the_main_webview() {
        assert!(validate_command_webview("main", "main").is_ok());
        assert_eq!(
            validate_command_webview("oleafly-browser-pane-1", "main").unwrap_err(),
            "MCP server settings are unavailable from this window."
        );
        assert_eq!(
            validate_command_webview("main", "preview").unwrap_err(),
            "MCP server settings are unavailable from this window."
        );
    }
}
