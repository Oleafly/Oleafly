use crate::config::{McpServerConfig, McpServerTransport};
use futures_util::StreamExt;
use reqwest::{redirect, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Duration;

const REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io/v0.1/servers";
const MAX_QUERY_BYTES: usize = 256;
const MAX_CURSOR_BYTES: usize = 512;
const MAX_RESULTS: usize = 20;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_TEXT_BYTES: usize = 4_096;
const MAX_ARGUMENTS: usize = 32;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrySearchRequest {
    pub query: String,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrySearchResult {
    pub servers: Vec<McpRegistryServer>,
    pub next_cursor: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryServer {
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub status: Option<String>,
    pub reviews: Vec<McpRegistryReview>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryReview {
    pub label: String,
    pub transport: String,
    pub command_or_url: String,
    pub arguments: Vec<String>,
    pub environment_variable_names: Vec<String>,
    pub config: Option<McpServerConfig>,
    pub unsupported_reason: Option<String>,
}

#[tauri::command]
pub async fn mcp_registry_search<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    request: McpRegistrySearchRequest,
) -> Result<McpRegistrySearchResult, String> {
    if webview.label() != "main" || webview.window().label() != "main" {
        return Err("MCP registry search is available only in the main window.".into());
    }
    let request = normalize_request(request)?;
    let response = fetch_registry(&request).await?;
    parse_registry_response(&response)
}

fn normalize_request(
    request: McpRegistrySearchRequest,
) -> Result<McpRegistrySearchRequest, String> {
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err("Enter a server name to search the official MCP registry.".into());
    }
    if query.len() > MAX_QUERY_BYTES || !query.is_char_boundary(MAX_QUERY_BYTES.min(query.len())) {
        return Err("Registry searches are limited to 256 bytes.".into());
    }
    if query.chars().any(char::is_control) {
        return Err("Registry searches cannot contain control characters.".into());
    }
    let cursor = request
        .cursor
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(cursor) = cursor.as_deref() {
        if cursor.len() > MAX_CURSOR_BYTES || cursor.chars().any(char::is_control) {
            return Err("Registry page cursor is invalid.".into());
        }
    }
    Ok(McpRegistrySearchRequest { query, cursor })
}

async fn fetch_registry(request: &McpRegistrySearchRequest) -> Result<Vec<u8>, String> {
    let mut url = Url::parse(REGISTRY_URL)
        .map_err(|_| "Official MCP registry URL is invalid.".to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("search", &request.query);
        query.append_pair("limit", &MAX_RESULTS.to_string());
        query.append_pair("version", "latest");
        if let Some(cursor) = request.cursor.as_deref() {
            query.append_pair("cursor", cursor);
        }
    }
    let client = reqwest::Client::builder()
        .redirect(redirect::Policy::none())
        .connect_timeout(REQUEST_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not prepare MCP registry search: {error}"))?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Could not reach the official MCP registry: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Official MCP registry returned HTTP {}.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("Official MCP registry response is too large.".into());
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| format!("Could not read MCP registry response: {error}"))?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("Official MCP registry response is too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn parse_registry_response(body: &[u8]) -> Result<McpRegistrySearchResult, String> {
    let root: Value = serde_json::from_slice(body)
        .map_err(|_| "Official MCP registry returned invalid JSON.".to_string())?;
    let object = root
        .as_object()
        .ok_or("Official MCP registry returned an invalid response.")?;
    let raw_servers = object
        .get("servers")
        .and_then(Value::as_array)
        .ok_or("Official MCP registry response did not include servers.")?;
    if raw_servers.len() > MAX_RESULTS {
        return Err("Official MCP registry returned too many servers.".into());
    }
    let mut warnings = Vec::new();
    let servers = raw_servers
        .iter()
        .filter_map(parse_server)
        .collect::<Vec<_>>();
    let ignored = raw_servers.len().saturating_sub(servers.len());
    if ignored > 0 {
        warnings.push(format!(
            "{ignored} registry {} ignored because {} metadata was invalid.",
            if ignored == 1 {
                "entry was"
            } else {
                "entries were"
            },
            if ignored == 1 { "its" } else { "their" },
        ));
    }
    let next_cursor = object
        .get("metadata")
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("nextCursor"));
    let next_cursor = match next_cursor {
        None | Some(Value::Null) => None,
        Some(Value::String(cursor)) if valid_text(cursor, MAX_CURSOR_BYTES) => Some(cursor.clone()),
        Some(_) => {
            warnings.push(
                "The registry returned an invalid page cursor. More results may be unavailable."
                    .into(),
            );
            None
        }
    };
    Ok(McpRegistrySearchResult {
        servers,
        next_cursor,
        warnings,
    })
}

fn parse_server(value: &Value) -> Option<McpRegistryServer> {
    let response = value.as_object()?;
    let server = response.get("server")?.as_object()?;
    let schema = server.get("$schema").and_then(Value::as_str)?;
    if !schema.starts_with("https://static.modelcontextprotocol.io/schemas/") {
        return None;
    }
    let name = server.get("name").and_then(Value::as_str)?;
    let version = server.get("version").and_then(Value::as_str)?;
    if !valid_text(name, 512) || !valid_pinned_version(version) {
        return None;
    }
    let description = server
        .get("description")
        .and_then(Value::as_str)
        .filter(|value| valid_text(value, MAX_TEXT_BYTES))
        .map(ToOwned::to_owned);
    let status = response
        .get("_meta")
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("io.modelcontextprotocol.registry/official"))
        .and_then(Value::as_object)
        .and_then(|official| official.get("status"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "active" | "deprecated"))
        .map(ToOwned::to_owned);
    let mut reviews: Vec<McpRegistryReview> = server
        .get("packages")
        .and_then(Value::as_array)
        .map(|packages| {
            packages
                .iter()
                .filter_map(|package| package_review(name, package))
                .collect()
        })
        .unwrap_or_default();
    if let Some(remotes) = server.get("remotes").and_then(Value::as_array) {
        reviews.extend(
            remotes
                .iter()
                .filter_map(|remote| remote_review(name, remote)),
        );
    }
    Some(McpRegistryServer {
        name: name.to_string(),
        description,
        version: version.to_string(),
        status,
        reviews,
    })
}

fn package_review(server_name: &str, package: &Value) -> Option<McpRegistryReview> {
    let package = package.as_object()?;
    let registry_type = package.get("registryType")?.as_str()?;
    let registry_base_url = package.get("registryBaseUrl").and_then(Value::as_str);
    let identifier = package.get("identifier")?.as_str()?;
    let version = package.get("version")?.as_str()?;
    let transport = package
        .get("transport")
        .and_then(Value::as_object)
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let runtime_hint = package.get("runtimeHint").and_then(Value::as_str);
    let environment_variable_names = package
        .get("environmentVariables")
        .and_then(Value::as_array)
        .map(|variables| {
            variables
                .iter()
                .filter_map(|value| value.get("name").and_then(Value::as_str))
                .filter(valid_environment_name)
                .map(ToOwned::to_owned)
                .take(64)
                .collect()
        })
        .unwrap_or_default();
    let label = format!("{registry_type}: {identifier}@{version}");
    let runtime_arguments = match package_arguments(package, "runtimeArguments") {
        Ok(arguments) => arguments,
        Err(reason) => {
            return Some(unsupported_review(
                label,
                transport,
                identifier,
                Vec::new(),
                environment_variable_names,
                &reason,
            ));
        }
    };
    let package_arguments = match package_arguments(package, "packageArguments") {
        Ok(arguments) => arguments,
        Err(reason) => {
            return Some(unsupported_review(
                label,
                transport,
                identifier,
                runtime_arguments,
                environment_variable_names,
                &reason,
            ));
        }
    };
    if registry_type != "npm"
        || transport != "stdio"
        || runtime_hint != Some("npx")
        || !is_npm_registry(registry_base_url)
    {
        return Some(unsupported_review(
            label,
            transport,
            identifier,
            runtime_arguments,
            environment_variable_names,
            "Oleafly can add pinned npm packages that use npx and stdio. This package format is not supported yet.",
        ));
    }
    if !valid_package_identifier(identifier) || !valid_pinned_version(version) {
        return Some(unsupported_review(
            label,
            transport,
            identifier,
            runtime_arguments,
            environment_variable_names,
            "This package does not include a safe pinned npm identifier and version.",
        ));
    }
    let package_argument = format!("{identifier}@{version}");
    let mut command_arguments = runtime_arguments;
    command_arguments.push(package_argument);
    command_arguments.extend(package_arguments);
    let config = McpServerConfig {
        name: configuration_name(server_name),
        enabled: true,
        transport: McpServerTransport::Stdio {
            command: "npx".into(),
            args: command_arguments.clone(),
            env: BTreeMap::new(),
        },
    };
    Some(McpRegistryReview {
        label,
        transport: transport.into(),
        command_or_url: "npx".into(),
        arguments: command_arguments,
        environment_variable_names,
        config: Some(config),
        unsupported_reason: None,
    })
}

fn remote_review(server_name: &str, remote: &Value) -> Option<McpRegistryReview> {
    let remote = remote.as_object()?;
    let transport = remote.get("type")?.as_str()?;
    let url = remote.get("url").and_then(Value::as_str).unwrap_or("");
    let variables = remote.get("variables").and_then(Value::as_object);
    let header_names = remote
        .get("headers")
        .and_then(Value::as_array)
        .map(|headers| {
            headers
                .iter()
                .filter_map(|header| header.get("name").and_then(Value::as_str))
                .filter(valid_header_name)
                .map(ToOwned::to_owned)
                .take(64)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let label = format!("remote: {url}");
    if !matches!(transport, "streamable-http" | "sse") || !valid_https_url(url) {
        return Some(unsupported_review(
            label,
            transport,
            url,
            Vec::new(),
            header_names,
            "Oleafly can add HTTPS streamable HTTP or SSE registry entries with a direct URL.",
        ));
    }
    if variables.is_some_and(|variables| !variables.is_empty()) || !header_names.is_empty() {
        return Some(unsupported_review(
            label,
            transport,
            url,
            Vec::new(),
            header_names,
            "This remote entry needs URL variables or headers. Add it manually so you can review each value.",
        ));
    }
    Some(McpRegistryReview {
        label,
        transport: transport.into(),
        command_or_url: url.into(),
        arguments: Vec::new(),
        environment_variable_names: Vec::new(),
        config: Some(McpServerConfig {
            name: configuration_name(server_name),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: url.into(),
                headers: BTreeMap::new(),
            },
        }),
        unsupported_reason: None,
    })
}

fn package_arguments(
    package: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<Vec<String>, String> {
    let Some(arguments) = package.get(field) else {
        return Ok(Vec::new());
    };
    let Some(arguments) = arguments.as_array() else {
        return Err(format!("The registry {field} metadata is malformed."));
    };
    if arguments.len() > MAX_ARGUMENTS {
        return Err(format!("The registry {field} list is too large."));
    }
    let mut output = Vec::with_capacity(arguments.len());
    for argument in arguments {
        let Some(argument) = argument.as_object() else {
            return Err(format!("The registry {field} metadata is malformed."));
        };
        if argument.get("type").and_then(Value::as_str) != Some("positional") {
            return Err(
                "This package needs named arguments. Add it manually so you can review the values."
                    .into(),
            );
        }
        let Some(value) = argument.get("value").and_then(Value::as_str) else {
            return Err("This package needs an argument value. Add it manually so you can review the value.".into());
        };
        if !valid_text(value, 512)
            || value.starts_with('@')
            || value.contains('\0')
            || value.contains(['{', '}'])
        {
            return Err("This package has an unsafe or templated argument. Add it manually so you can review the value.".into());
        }
        output.push(value.to_string());
    }
    Ok(output)
}

fn unsupported_review(
    label: String,
    transport: &str,
    identifier: &str,
    arguments: Vec<String>,
    environment_variable_names: Vec<String>,
    reason: &str,
) -> McpRegistryReview {
    McpRegistryReview {
        label,
        transport: transport.into(),
        command_or_url: identifier.into(),
        arguments,
        environment_variable_names,
        config: None,
        unsupported_reason: Some(reason.into()),
    }
}

fn configuration_name(server_name: &str) -> String {
    let segment = server_name.rsplit('/').next().unwrap_or(server_name);
    let mut output = segment
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    output = output.trim_matches('-').to_string();
    if output.is_empty() {
        "registry-server".into()
    } else {
        output.chars().take(64).collect()
    }
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn valid_pinned_version(value: &str) -> bool {
    valid_text(value, 255)
        && value != "latest"
        && !value.contains(['^', '~', '*', '>', '<', '=', ' '])
}

fn valid_package_identifier(value: &str) -> bool {
    valid_text(value, 512)
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '@' | '/' | '-' | '_' | '.')
        })
}

fn is_npm_registry(value: Option<&str>) -> bool {
    matches!(
        value,
        Some("https://registry.npmjs.org") | Some("https://registry.npmjs.org/")
    )
}

fn valid_https_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    url.scheme() == "https" && url.host_str().is_some() && valid_text(value, 2_048)
}

fn valid_environment_name(value: &&str) -> bool {
    valid_text(value, 128)
        && value.chars().enumerate().all(|(index, character)| {
            character == '_'
                || character.is_ascii_uppercase()
                || (index > 0 && character.is_ascii_digit())
        })
}

fn valid_header_name(value: &&str) -> bool {
    valid_text(value, 128)
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

#[cfg(test)]
mod tests {
    use super::{normalize_request, parse_registry_response, McpRegistrySearchRequest};

    #[test]
    fn maps_pinned_npx_stdio_packages_without_running_them() {
        let result = parse_registry_response(br#"{
          "servers": [{"server": {"$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json", "name": "io.example/papers", "version": "1.2.3", "packages": [{"registryType": "npm", "registryBaseUrl": "https://registry.npmjs.org", "identifier": "@example/papers", "version": "1.2.3", "runtimeHint": "npx", "transport": {"type": "stdio"}, "runtimeArguments": [{"type": "positional", "value": "-y"}], "environmentVariables": [{"name": "PAPERS_TOKEN", "isSecret": true}]}]}}],
          "metadata": {"nextCursor": "io.example/papers:1.2.3"}
        }"#).unwrap();
        let review = &result.servers[0].reviews[0];
        assert_eq!(review.command_or_url, "npx");
        assert_eq!(review.arguments, vec!["-y", "@example/papers@1.2.3"]);
        assert_eq!(review.environment_variable_names, vec!["PAPERS_TOKEN"]);
        assert!(review.config.is_some());
    }

    #[test]
    fn retains_unsupported_packages_as_review_only_entries() {
        let result = parse_registry_response(br#"{
          "servers": [{"server": {"$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json", "name": "io.example/remote", "version": "1.2.3", "packages": [{"registryType": "pypi", "identifier": "remote", "version": "1.2.3", "transport": {"type": "stdio"}}]}}]
        }"#).unwrap();
        let review = &result.servers[0].reviews[0];
        assert!(review.config.is_none());
        assert!(review.unsupported_reason.is_some());
    }

    #[test]
    fn maps_direct_https_remotes_and_requires_manual_review_for_headers() {
        let result = parse_registry_response(br#"{
          "servers": [{"server": {"$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json", "name": "io.example/remote", "version": "1.2.3", "remotes": [
            {"type": "streamable-http", "url": "https://example.test/mcp"},
            {"type": "streamable-http", "url": "https://example.test/private", "headers": [{"name": "Authorization"}]}
          ]}}]
        }"#).unwrap();
        assert!(result.servers[0].reviews[0].config.is_some());
        assert!(result.servers[0].reviews[1].config.is_none());
        assert_eq!(
            result.servers[0].reviews[1].environment_variable_names,
            vec!["Authorization"]
        );
    }

    #[test]
    fn skips_malformed_entries_but_keeps_valid_entries() {
        let result = parse_registry_response(br#"{
          "servers": [
            {"server": {"$schema": "https://wrong.example/schema", "name": "bad", "version": "1.0.0"}},
            {"server": {"$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json", "name": "io.example/good", "version": "1.0.0"}}
          ]
        }"#).unwrap();
        assert_eq!(result.servers.len(), 1);
        assert_eq!(result.servers[0].name, "io.example/good");
        assert_eq!(result.warnings.len(), 1);
    }

    #[test]
    fn rejects_empty_or_control_character_queries() {
        assert!(normalize_request(McpRegistrySearchRequest {
            query: "  ".into(),
            cursor: None
        })
        .is_err());
        assert!(normalize_request(McpRegistrySearchRequest {
            query: "files\n".into(),
            cursor: None
        })
        .is_err());
    }
}
