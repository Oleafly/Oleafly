use crate::config::{AppConfig, McpServerConfig, McpServerTransport};
use futures_util::StreamExt;
use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::time::Duration;
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
const MAX_STDIO_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REMOTE_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const VALIDATION_TIMEOUT: Duration = Duration::from_secs(10);
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
}

impl RemoteTransport {
    fn new(
        url: &str,
        headers: &std::collections::BTreeMap<String, String>,
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
            .timeout(VALIDATION_TIMEOUT)
            .build()
            .map_err(|_| protocol_error("remote HTTP client could not be created"))?;
        Ok(Self {
            client,
            url,
            headers: request_headers,
            session_id: None,
            protocol_version: None,
        })
    }

    async fn send_request(
        &mut self,
        message: serde_json::Value,
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
        }
        let response = request
            .json(&message)
            .send()
            .await
            .map_err(classify_remote_error)?;
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
                let chunk = chunk.map_err(classify_remote_error)?;
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
            let chunk = chunk.map_err(classify_remote_error)?;
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
        Box::pin(self.send_request(message))
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
}

fn classify_remote_error(error: reqwest::Error) -> McpConnectionError {
    if error.is_timeout() {
        return McpConnectionError::Timeout;
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

fn redact_with_matcher(message: &str, matcher: Option<&aho_corasick::AhoCorasick>) -> String {
    let Some(matcher) = matcher else {
        return bounded_message(message);
    };
    let mut redacted = String::with_capacity(message.len());
    let mut copied = 0;
    for matched in matcher.find_iter(message) {
        redacted.push_str(&message[copied..matched.start()]);
        redacted.push_str("[stored value]");
        copied = matched.end();
    }
    redacted.push_str(&message[copied..]);
    bounded_message(&redacted)
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
        if PROTECTED_HEADERS.contains(&normalized.as_str()) {
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
    let mut probe = StdioTransport::spawn(command, args, environment).await?;
    let discovery = discover_server(&mut probe).await;
    match discovery {
        Ok(true) => {
            let result = list_tools(&mut probe, 2, true).await;
            probe.shutdown().await;
            result
        }
        Err(error @ McpConnectionError::ModernProtocol { .. }) => {
            probe.shutdown().await;
            Err(error)
        }
        Ok(false) | Err(_) => {
            probe.shutdown().await;
            let mut transport = StdioTransport::spawn(command, args, environment).await?;
            let result = connect_legacy_and_list_tools(&mut transport).await;
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
    list_tools(transport, 3, false).await
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
}

impl Default for McpClientState {
    fn default() -> Self {
        Self {
            mutation: tokio::sync::Mutex::new(()),
            validations: tokio::sync::Semaphore::new(MAX_CONCURRENT_VALIDATIONS),
        }
    }
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

    async fn good_connect(
        _server: McpServerConfig,
    ) -> Result<Vec<McpServerTool>, McpConnectionError> {
        Ok(vec![McpServerTool {
            name: "search".into(),
            description: None,
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

    #[tokio::test]
    async fn successful_validation_reports_every_tool() {
        let result = validate_with(&stdio_server("search-server"), |_| async {
            Ok(vec![
                McpServerTool {
                    name: "search".into(),
                    description: Some("Search papers".into()),
                },
                McpServerTool {
                    name: "fetch".into(),
                    description: None,
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
