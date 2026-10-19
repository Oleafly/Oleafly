//! A small MCP client for the user's servers (the ones turned on in
//! Oleafly's settings): stdio programs and streamable-HTTP servers. Tools
//! keep the app's names (`mcp_ext_<server>_<tool>_<hash>`), so a run and the
//! app call the same tool the same way.
//!
//! A stdio server runs a program, so it needs `--allow commands`; a remote
//! server needs `--allow network`; `oleafly ask` keeps only tools that say
//! they only read. Server values (env, headers) never appear in a warning,
//! an error or a result.
pub mod http;
pub mod stdio;

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use oleafly_agent::{CancellationToken, ToolSchema};
use serde_json::{json, Value};

use super::desktop_config::{McpServer, McpTransport};
use super::policy::RunPolicy;
use crate::app_paths::Platform;

pub const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
#[cfg(not(test))]
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
#[cfg(test)]
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_TOOLS_PER_SERVER: usize = 128;
const MAX_TOOLS: usize = 256;
const MAX_LIST_PAGES: usize = 16;
const MAX_DESCRIPTION_CHARS: usize = 2_000;
const MAX_ERROR_CHARS: usize = 600;
/// A message (a line or an event) larger than this ends the connection.
pub(crate) const MAX_FRAME_BYTES: usize = 4 << 20;

/// Which servers a run uses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpSelection {
    All,
    None,
    Named(Vec<String>),
}

#[derive(Clone)]
pub struct McpToolSpec {
    /// The name the model sees.
    pub agent_name: String,
    pub server: String,
    /// The server's own tool name.
    pub tool: String,
    pub schema: ToolSchema,
    pub read_only_hint: bool,
}

/// One connected server.
enum Connection {
    Stdio(stdio::StdioConnection),
    Http(http::HttpConnection),
}

impl Connection {
    async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        match self {
            Self::Stdio(connection) => connection.request(method, params, timeout).await,
            Self::Http(connection) => connection.request(method, params, timeout).await,
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        match self {
            Self::Stdio(connection) => connection.notify(method, params).await,
            Self::Http(connection) => connection.notify(method, params).await,
        }
    }

    async fn close(&self) {
        match self {
            Self::Stdio(connection) => connection.close().await,
            Self::Http(connection) => connection.close().await,
        }
    }
}

struct Server {
    name: String,
    connection: Connection,
    matcher: Option<AhoCorasick>,
}

/// The servers a run connected to, and their tools.
pub struct McpHub {
    servers: Vec<Server>,
    tools: Vec<McpToolSpec>,
    /// Every secret the run knows (keys, server values).
    secrets: Option<AhoCorasick>,
}

fn identifier_part(value: &str, fallback: &str, max_len: usize) -> String {
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

/// The model-facing name of `tool` on `server`; byte for byte the app's.
pub fn agent_tool_name(server: &str, tool: &str) -> String {
    use sha2::Digest as _;
    let server_part = identifier_part(server, "server", 16);
    let tool_part = identifier_part(tool, "tool", 24);
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

fn split_list(value: &OsStr, platform: Platform) -> Vec<String> {
    let separator = if platform == Platform::Windows {
        ';'
    } else {
        ':'
    };
    value
        .to_string_lossy()
        .split(separator)
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

fn join_dir(dir: &str, name: &str, platform: Platform) -> PathBuf {
    if platform == Platform::Windows {
        PathBuf::from(format!("{}\\{name}", dir.trim_end_matches(['\\', '/'])))
    } else {
        Path::new(dir).join(name)
    }
}

/// The program a stdio server names: a path as it is, else the first match
/// on `PATH` (on Windows with each `PATHEXT` extension, so `npx` finds
/// `npx.cmd`).
pub(crate) fn resolve_program(
    program: &str,
    platform: Platform,
    path_var: Option<&OsStr>,
    pathext: Option<&OsStr>,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let program = program.trim();
    if program.is_empty() {
        return None;
    }
    let has_separator =
        program.contains('/') || (platform == Platform::Windows && program.contains('\\'));
    let windows_absolute = platform == Platform::Windows
        && program.len() > 2
        && program.as_bytes()[1] == b':'
        && program.as_bytes()[0].is_ascii_alphabetic();
    if has_separator || windows_absolute || Path::new(program).is_absolute() {
        return Some(PathBuf::from(program));
    }
    let directories = path_var
        .map(|value| split_list(value, platform))
        .unwrap_or_default();
    let extensions: Vec<String> = if platform == Platform::Windows {
        let has_extension = Path::new(program).extension().is_some();
        let mut extensions = if has_extension {
            vec![String::new()]
        } else {
            Vec::new()
        };
        let listed = pathext
            .map(|value| split_list(value, platform))
            .unwrap_or_else(|| {
                [".COM", ".EXE", ".BAT", ".CMD"]
                    .iter()
                    .map(|extension| (*extension).to_string())
                    .collect()
            });
        extensions.extend(
            listed
                .into_iter()
                .map(|extension| extension.to_ascii_lowercase()),
        );
        extensions
    } else {
        vec![String::new()]
    };
    for directory in &directories {
        for extension in &extensions {
            let candidate = join_dir(directory, &format!("{program}{extension}"), platform);
            if exists(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// A matcher over `values` (leftmost longest), or none.
pub(crate) fn matcher(values: &[String]) -> Option<AhoCorasick> {
    let mut values: Vec<&str> = values
        .iter()
        .map(String::as_str)
        .filter(|value| value.len() >= 4)
        .collect();
    values.sort_unstable();
    values.dedup();
    if values.is_empty() {
        return None;
    }
    AhoCorasickBuilder::new()
        .match_kind(MatchKind::LeftmostLongest)
        .build(&values)
        .ok()
}

/// `text` with every match replaced.
pub(crate) fn redact_with(text: &str, matcher: Option<&AhoCorasick>) -> String {
    let Some(matcher) = matcher else {
        return text.to_string();
    };
    let mut redacted = String::with_capacity(text.len());
    let mut copied = 0;
    for found in matcher.find_iter(text) {
        redacted.push_str(&text[copied..found.start()]);
        redacted.push_str("[stored value]");
        copied = found.end();
    }
    redacted.push_str(&text[copied..]);
    redacted
}

fn redact_value(value: Value, matcher: Option<&AhoCorasick>) -> Value {
    match value {
        Value::String(text) => Value::String(redact_with(&text, matcher)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|value| redact_value(value, matcher))
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (redact_with(&key, matcher), redact_value(value, matcher)))
                .collect(),
        ),
        other => other,
    }
}

fn bounded(text: &str, max_chars: usize) -> String {
    text.chars()
        .filter(|character| *character == '\n' || !character.is_control())
        .take(max_chars)
        .collect()
}

fn strip_header_extensions(value: Value) -> Value {
    match value {
        Value::Array(values) => {
            Value::Array(values.into_iter().map(strip_header_extensions).collect())
        }
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .filter(|(key, _)| key != "x-mcp-header")
                .map(|(key, value)| (key, strip_header_extensions(value)))
                .collect(),
        ),
        other => other,
    }
}

fn server_values(server: &McpServer) -> Vec<String> {
    let mut values = Vec::new();
    match &server.transport {
        McpTransport::Stdio { env, .. } => values.extend(env.values().cloned()),
        McpTransport::Remote { headers, .. } => {
            for value in headers.values() {
                values.push(value.clone());
                if let Some(token) = value
                    .strip_prefix("Bearer ")
                    .or_else(|| value.strip_prefix("bearer "))
                {
                    values.push(token.to_string());
                }
            }
        }
    }
    values.retain(|value| !value.trim().is_empty());
    values
}

/// The text of a `tools/call` result: text parts joined, images left out
/// with a note. An error result is an `Err`.
pub(crate) fn result_text(result: &Value) -> Result<String, String> {
    let mut parts = Vec::new();
    let mut images = 0;
    for part in result["content"].as_array().into_iter().flatten() {
        match part["type"].as_str() {
            Some("text") => parts.push(part["text"].as_str().unwrap_or_default().to_string()),
            Some("image") => images += 1,
            Some("resource") => {
                if let Some(text) = part["resource"]["text"].as_str() {
                    parts.push(text.to_string());
                }
            }
            _ => {}
        }
    }
    if parts.is_empty() {
        if let Some(structured) = result.get("structuredContent") {
            parts.push(structured.to_string());
        }
    }
    if images > 0 {
        parts.push(format!("[{images} image(s) left out]"));
    }
    let text = parts.join("\n");
    if result["isError"].as_bool() == Some(true) {
        Err(if text.is_empty() {
            "The MCP tool reported an error.".into()
        } else {
            text
        })
    } else {
        Ok(text)
    }
}

fn initialize_params() -> Value {
    json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {"name": "oleafly", "title": "Oleafly", "version": crate::version::APP_VERSION},
    })
}

/// Connects one server and lists its tools.
async fn connect_one(
    server: &McpServer,
    values: Option<&AhoCorasick>,
) -> Result<(Connection, Vec<Value>), String> {
    let started = match &server.transport {
        McpTransport::Stdio { command, args, env } => {
            stdio::StdioConnection::spawn(command, args, env)
                .await
                .map(Connection::Stdio)
        }
        McpTransport::Remote { url, headers } => {
            http::HttpConnection::new(url, headers).map(Connection::Http)
        }
    };
    let connection =
        started.map_err(|error| bounded(&redact_with(&error, values), MAX_ERROR_CHARS))?;
    let setup = async {
        let initialized = connection
            .request("initialize", initialize_params(), CONNECT_TIMEOUT)
            .await?;
        if let (Connection::Http(http), Some(version)) =
            (&connection, initialized["protocolVersion"].as_str())
        {
            http.set_protocol_version(version);
        }
        connection
            .notify("notifications/initialized", json!({}))
            .await?;
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_LIST_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({"cursor": cursor}),
                None => json!({}),
            };
            let page = connection
                .request("tools/list", params, CONNECT_TIMEOUT)
                .await?;
            tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
            cursor = page["nextCursor"]
                .as_str()
                .filter(|next| !next.is_empty())
                .map(str::to_owned);
            if cursor.is_none() || tools.len() >= MAX_TOOLS_PER_SERVER {
                break;
            }
        }
        tools.truncate(MAX_TOOLS_PER_SERVER);
        Ok::<_, String>(tools)
    };
    match tokio::time::timeout(CONNECT_TIMEOUT, setup).await {
        Ok(Ok(tools)) => Ok((connection, tools)),
        Ok(Err(error)) => {
            connection.close().await;
            Err(bounded(&redact_with(&error, values), MAX_ERROR_CHARS))
        }
        Err(_) => {
            connection.close().await;
            Err(format!(
                "it did not answer within {} seconds",
                CONNECT_TIMEOUT.as_secs()
            ))
        }
    }
}

impl McpHub {
    /// No servers.
    pub fn empty() -> Self {
        Self {
            servers: Vec::new(),
            tools: Vec::new(),
            secrets: None,
        }
    }

    /// Connects the selected servers the policy allows, in parallel. A
    /// server that fails is left out with a warning; the run goes on.
    pub async fn connect(
        servers: &[McpServer],
        policy: &RunPolicy,
        selection: &McpSelection,
        secrets: &[String],
        cancel: &CancellationToken,
    ) -> (McpHub, Vec<String>) {
        let mut warnings = Vec::new();
        let mut chosen: Vec<&McpServer> = match selection {
            McpSelection::None => Vec::new(),
            McpSelection::All => servers.iter().collect(),
            McpSelection::Named(names) => {
                for name in names {
                    if !servers.iter().any(|server| &server.name == name) {
                        warnings.push(format!(
                            "No MCP server named {name} is turned on in Oleafly."
                        ));
                    }
                }
                servers
                    .iter()
                    .filter(|server| names.contains(&server.name))
                    .collect()
            }
        };
        chosen.retain(|server| match &server.transport {
            McpTransport::Stdio { .. } if policy.question => {
                warnings.push(format!(
                    "The MCP server {} runs a program on this computer, which oleafly ask doesn't do.",
                    server.name
                ));
                false
            }
            McpTransport::Stdio { .. } if !policy.allow.commands => {
                warnings.push(format!(
                    "The MCP server {} runs a program on this computer, so it needs --allow commands.",
                    server.name
                ));
                false
            }
            McpTransport::Remote { .. } if !policy.allow.network => {
                warnings.push(format!("The MCP server {} is on the network, so it needs --allow network.", server.name));
                false
            }
            _ => true,
        });
        let mut all_secrets: Vec<String> = secrets.to_vec();
        for server in &chosen {
            all_secrets.extend(server_values(server));
        }
        let secrets_matcher = matcher(&all_secrets);
        let attempts = chosen.iter().map(|server| {
            let values = matcher(&server_values(server));
            async move {
                let result = connect_one(server, values.as_ref()).await;
                (server, values, result)
            }
        });
        let results = tokio::select! {
            results = futures_util::future::join_all(attempts) => results,
            _ = cancel.cancelled() => Vec::new(),
        };
        let mut hub = McpHub {
            servers: Vec::new(),
            tools: Vec::new(),
            secrets: secrets_matcher,
        };
        for (server, values, result) in results {
            match result {
                Ok((connection, tools)) => {
                    for tool in tools {
                        if hub.tools.len() >= MAX_TOOLS {
                            warnings
                                .push(format!("Only the first {MAX_TOOLS} MCP tools are used."));
                            break;
                        }
                        let Some(name) = tool["name"]
                            .as_str()
                            .filter(|name| !name.is_empty() && name.len() <= 128)
                        else {
                            continue;
                        };
                        // A tool named after a stored value would show it to the model.
                        if values.as_ref().is_some_and(|values| values.is_match(name)) {
                            continue;
                        }
                        let read_only_hint =
                            tool["annotations"]["readOnlyHint"].as_bool() == Some(true);
                        if policy.question && !read_only_hint {
                            continue;
                        }
                        let agent_name = agent_tool_name(&server.name, name);
                        if hub.tools.iter().any(|known| known.agent_name == agent_name) {
                            continue;
                        }
                        let description = redact_with(
                            tool["description"].as_str().unwrap_or_default(),
                            values.as_ref(),
                        );
                        let schema = match tool.get("inputSchema") {
                            Some(schema) if schema.is_object() => {
                                strip_header_extensions(schema.clone())
                            }
                            _ => json!({"type": "object", "properties": {}}),
                        };
                        hub.tools.push(McpToolSpec {
                            agent_name: agent_name.clone(),
                            server: server.name.clone(),
                            tool: name.to_string(),
                            schema: ToolSchema {
                                name: agent_name,
                                description: bounded(
                                    &format!("{} (MCP server {})", description.trim(), server.name),
                                    MAX_DESCRIPTION_CHARS,
                                ),
                                input_schema: schema,
                            },
                            read_only_hint,
                        });
                    }
                    hub.servers.push(Server {
                        name: server.name.clone(),
                        connection,
                        matcher: values,
                    });
                }
                Err(reason) => warnings.push(format!(
                    "The MCP server {} could not start: {reason}",
                    server.name
                )),
            }
        }
        let warnings = warnings
            .into_iter()
            .map(|warning| redact_with(&warning, hub.secrets.as_ref()))
            .collect();
        (hub, warnings)
    }

    pub fn tools(&self) -> &[McpToolSpec] {
        &self.tools
    }

    /// Names of the connected servers.
    pub fn server_names(&self) -> Vec<String> {
        self.servers
            .iter()
            .map(|server| server.name.clone())
            .collect()
    }

    /// Calls a tool by its model-facing name; the raw `tools/call` result
    /// with the server's values replaced.
    pub async fn call_raw(
        &self,
        agent_name: &str,
        arguments: Value,
        cancel: &CancellationToken,
    ) -> Result<Value, String> {
        let tool = self
            .tools
            .iter()
            .find(|tool| tool.agent_name == agent_name)
            .ok_or_else(|| format!("The tool {agent_name} is not available in this run."))?;
        let server = self
            .servers
            .iter()
            .find(|server| server.name == tool.server)
            .ok_or("The MCP server of this tool has stopped.")?;
        let arguments = if arguments.is_object() {
            arguments
        } else {
            json!({})
        };
        let call = server.connection.request(
            "tools/call",
            json!({"name": tool.tool, "arguments": arguments}),
            CALL_TIMEOUT,
        );
        let result = tokio::select! {
            result = call => result,
            _ = cancel.cancelled() => return Err("The run was stopped.".into()),
        };
        let all = self.secrets.as_ref();
        match result {
            Ok(value) => Ok(redact_value(
                redact_value(value, server.matcher.as_ref()),
                all,
            )),
            Err(error) => Err(bounded(
                &redact_with(&redact_with(&error, server.matcher.as_ref()), all),
                MAX_ERROR_CHARS,
            )),
        }
    }

    /// Calls a tool and returns its text.
    pub async fn call(
        &self,
        agent_name: &str,
        arguments: Value,
        cancel: &CancellationToken,
    ) -> Result<String, String> {
        result_text(&self.call_raw(agent_name, arguments, cancel).await?)
    }

    /// The tools for a research task in the background helper.
    pub fn as_task_tools(self: &Arc<Self>) -> Vec<oleafly_research::builtin::TaskMcpTool> {
        self.tools
            .iter()
            .map(|tool| {
                let hub = self.clone();
                let name = tool.agent_name.clone();
                oleafly_research::builtin::TaskMcpTool {
                    schema: tool.schema.clone(),
                    call: Arc::new(move |arguments| {
                        let hub = hub.clone();
                        let name = name.clone();
                        Box::pin(async move {
                            hub.call_raw(&name, arguments, &CancellationToken::new())
                                .await
                        })
                    }),
                }
            })
            .collect()
    }

    /// Stops every server.
    pub async fn shutdown(&self) {
        futures_util::future::join_all(self.servers.iter().map(|server| server.connection.close()))
            .await;
    }
}

/// The servers as ACP `mcpServers` entries, for a CLI agent's session.
pub fn acp_server_specs(servers: &[McpServer]) -> Vec<Value> {
    let pairs = |values: &BTreeMap<String, String>| -> Vec<Value> {
        values
            .iter()
            .map(|(name, value)| json!({"name": name, "value": value}))
            .collect()
    };
    servers
        .iter()
        .map(|server| match &server.transport {
            McpTransport::Stdio { command, args, env } => json!({
                "name": server.name,
                "command": command,
                "args": args,
                "env": pairs(env),
            }),
            McpTransport::Remote { url, headers } => json!({
                "type": "http",
                "name": server.name,
                "url": url,
                "headers": pairs(headers),
            }),
        })
        .collect()
}

#[cfg(test)]
#[path = "../../../tests/support/mcp_fixture.rs"]
pub(crate) mod mcp_fixture;

#[cfg(test)]
mod tests;
