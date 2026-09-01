use crate::config::{McpServerConfig, McpServerTransport};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use serde::Serialize;
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Component, Path};

const MAX_SOURCE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMcpServer {
    pub source_tool: String,
    #[serde(flatten)]
    pub server: McpServerConfig,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SourceTool {
    ClaudeDesktop,
    ClaudeCode,
    Codex,
    Cursor,
    Windsurf,
}

#[derive(Clone, Copy)]
enum JsonInterpolation {
    None,
    ClaudeCode,
    Environment,
}

impl SourceTool {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "claude-desktop" => Ok(Self::ClaudeDesktop),
            "claude-code" => Ok(Self::ClaudeCode),
            "codex" => Ok(Self::Codex),
            "cursor" => Ok(Self::Cursor),
            "windsurf" => Ok(Self::Windsurf),
            _ => Err("Unsupported MCP source tool. Expected claude-desktop, claude-code, codex, cursor, or windsurf.".into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeDesktop => "claude-desktop",
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::Windsurf => "windsurf",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::ClaudeDesktop => "Claude Desktop",
            Self::ClaudeCode => "Claude Code",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor",
            Self::Windsurf => "Windsurf",
        }
    }

    fn user_path(self) -> &'static str {
        match self {
            Self::ClaudeDesktop => "Library/Application Support/Claude/claude_desktop_config.json",
            Self::ClaudeCode => ".claude.json",
            Self::Codex => ".codex/config.toml",
            Self::Cursor => ".cursor/mcp.json",
            Self::Windsurf => ".codeium/windsurf/mcp_config.json",
        }
    }
}

fn import_source_at<F>(
    source_tool: &str,
    home: &Path,
    project_root: Option<&Path>,
    env_lookup: &F,
) -> Result<Vec<ImportedMcpServer>, String>
where
    F: Fn(&str) -> Option<String>,
{
    let source = SourceTool::parse(source_tool)?;
    let servers = match source {
        SourceTool::ClaudeCode => import_claude_code_at(home, project_root, env_lookup)?,
        SourceTool::Cursor => import_cursor_at(home, project_root, env_lookup)?,
        SourceTool::Codex => {
            let Some(contents) =
                read_source_file(home, Path::new(source.user_path()), source.label())?
            else {
                return Ok(Vec::new());
            };
            parse_codex_servers(&contents, env_lookup)?
        }
        SourceTool::Windsurf => {
            let Some(contents) =
                read_source_file(home, Path::new(source.user_path()), source.label())?
            else {
                return Ok(Vec::new());
            };
            parse_json_servers(
                &contents,
                source.label(),
                true,
                JsonInterpolation::Environment,
                env_lookup,
            )?
        }
        SourceTool::ClaudeDesktop => {
            let Some(contents) =
                read_source_file(home, Path::new(source.user_path()), source.label())?
            else {
                return Ok(Vec::new());
            };
            parse_json_servers(
                &contents,
                source.label(),
                false,
                JsonInterpolation::None,
                env_lookup,
            )?
        }
    };
    Ok(imported_servers(source, servers))
}

fn import_claude_code_at(
    home: &Path,
    project_root: Option<&Path>,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<BTreeMap<String, McpServerConfig>, String> {
    let user_contents = read_source_file(home, Path::new(".claude.json"), "Claude Code")?;
    let user_root = user_contents
        .as_deref()
        .map(|contents| parse_json_document(contents, "Claude Code"))
        .transpose()?;
    let mut servers = user_root
        .as_ref()
        .map(|root| {
            parse_json_servers_from_root(
                root,
                "Claude Code",
                false,
                JsonInterpolation::ClaudeCode,
                env_lookup,
            )
        })
        .transpose()?
        .unwrap_or_default();
    let Some(project_root) = project_root else {
        return Ok(servers);
    };
    let project_contents = read_source_file(project_root, Path::new(".mcp.json"), "Claude Code")?;
    if let Some(project_contents) = project_contents {
        servers.extend(parse_json_servers(
            &project_contents,
            "Claude Code",
            false,
            JsonInterpolation::ClaudeCode,
            env_lookup,
        )?);
    }
    if let Some(user_root) = user_root.as_ref() {
        servers.extend(parse_claude_local_scope(
            user_root,
            project_root,
            env_lookup,
        )?);
    }
    Ok(servers)
}

fn parse_claude_local_scope(
    root: &JsonValue,
    project_root: &Path,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<BTreeMap<String, McpServerConfig>, String> {
    let root = root
        .as_object()
        .ok_or_else(|| "Claude Code MCP config must be a JSON object.".to_string())?;
    let Some(projects) = root.get("projects") else {
        return Ok(BTreeMap::new());
    };
    let projects = projects
        .as_object()
        .ok_or_else(|| "Claude Code MCP config field 'projects' must be an object.".to_string())?;
    let canonical_project = project_root
        .canonicalize()
        .map_err(|_| "Claude Code project root could not be resolved.".to_string())?;
    let Some(project) = projects.get(canonical_project.to_string_lossy().as_ref()) else {
        return Ok(BTreeMap::new());
    };
    let project = project
        .as_object()
        .ok_or_else(|| "Claude Code MCP project scope must be a JSON object.".to_string())?;
    let Some(servers) = project.get("mcpServers") else {
        return Ok(BTreeMap::new());
    };
    parse_json_server_map(
        servers,
        "Claude Code",
        false,
        JsonInterpolation::ClaudeCode,
        env_lookup,
    )
}

fn import_cursor_at(
    home: &Path,
    project_root: Option<&Path>,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<BTreeMap<String, McpServerConfig>, String> {
    let mut servers = read_source_file(home, Path::new(".cursor/mcp.json"), "Cursor")?
        .as_deref()
        .map(|contents| {
            parse_json_servers(
                contents,
                "Cursor",
                false,
                JsonInterpolation::Environment,
                env_lookup,
            )
        })
        .transpose()?
        .unwrap_or_default();
    if let Some(project_root) = project_root {
        if let Some(contents) =
            read_source_file(project_root, Path::new(".cursor/mcp.json"), "Cursor")?
        {
            servers.extend(parse_json_servers(
                &contents,
                "Cursor",
                false,
                JsonInterpolation::Environment,
                env_lookup,
            )?);
        }
    }
    Ok(servers)
}

fn imported_servers(
    source: SourceTool,
    servers: BTreeMap<String, McpServerConfig>,
) -> Vec<ImportedMcpServer> {
    servers
        .into_values()
        .map(|server| ImportedMcpServer {
            source_tool: source.as_str().into(),
            server,
        })
        .collect()
}

fn read_source_file(root: &Path, relative: &Path, label: &str) -> Result<Option<String>, String> {
    read_source_file_with_hook(root, relative, label, || {})
}

fn read_source_file_with_hook<F>(
    root: &Path,
    relative: &Path,
    label: &str,
    before_open: F,
) -> Result<Option<String>, String>
where
    F: FnOnce(),
{
    let components = relative.components().collect::<Vec<_>>();
    if components.is_empty()
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("{label} MCP source path is not confined."));
    }

    let mut directory =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|_| {
            match std::fs::symlink_metadata(root) {
                Ok(metadata)
                    if !metadata.is_dir()
                        || metadata.file_type().is_symlink()
                        || is_reparse_point(&metadata) =>
                {
                    format!("{label} MCP source root must be a real directory.")
                }
                _ => format!("{label} MCP source root is unavailable."),
            }
        })?;
    let (file_component, directory_components) = components.split_last().unwrap();
    for component in directory_components {
        let component_path = Path::new(component.as_os_str());
        let metadata = match directory.symlink_metadata(component_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(format!("{label} MCP source could not be inspected.")),
        };
        if metadata.is_symlink() {
            return Err(format!("{label} MCP source path contains a symbolic link."));
        }
        if !metadata.is_dir() {
            return Err(format!(
                "{label} MCP source path contains a non-directory component."
            ));
        }
        directory = directory
            .open_dir_nofollow(component_path)
            .map_err(|_| format!("{label} MCP source path could not be opened safely."))?;
    }

    let file_path = Path::new(file_component.as_os_str());
    let source_metadata = match directory.symlink_metadata(file_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(format!("{label} MCP source could not be inspected.")),
    };
    if source_metadata.is_symlink() {
        return Err(format!("{label} MCP source path contains a symbolic link."));
    }
    if !source_metadata.is_file() {
        return Err(format!("{label} MCP source is not a regular file."));
    }
    before_open();

    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let mut file = directory
        .open_with(file_path, &options)
        .map_err(|_| format!("{label} MCP source could not be read."))?;
    let metadata = file
        .metadata()
        .map_err(|_| format!("{label} MCP source could not be inspected."))?;
    if !metadata.is_file() {
        return Err(format!("{label} MCP source is not a regular file."));
    }
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err(format!(
            "{label} MCP source exceeds the {MAX_SOURCE_BYTES} byte limit."
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| format!("{label} MCP source could not be read."))?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err(format!(
            "{label} MCP source exceeds the {MAX_SOURCE_BYTES} byte limit."
        ));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| format!("{label} MCP source is not valid UTF-8."))
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn parse_json_servers(
    contents: &str,
    label: &str,
    allow_server_url: bool,
    interpolation: JsonInterpolation,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<BTreeMap<String, McpServerConfig>, String> {
    let root = parse_json_document(contents, label)?;
    parse_json_servers_from_root(&root, label, allow_server_url, interpolation, env_lookup)
}

fn parse_json_document(contents: &str, label: &str) -> Result<JsonValue, String> {
    serde_json::from_str(contents).map_err(|error| {
        format!(
            "{label} MCP config is invalid JSON at line {} column {}.",
            error.line(),
            error.column()
        )
    })
}

fn parse_json_servers_from_root(
    root: &JsonValue,
    label: &str,
    allow_server_url: bool,
    interpolation: JsonInterpolation,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<BTreeMap<String, McpServerConfig>, String> {
    let root = root
        .as_object()
        .ok_or_else(|| format!("{label} MCP config must be a JSON object."))?;
    let Some(servers) = root.get("mcpServers") else {
        return Ok(BTreeMap::new());
    };
    parse_json_server_map(servers, label, allow_server_url, interpolation, env_lookup)
}

fn parse_json_server_map(
    value: &JsonValue,
    label: &str,
    allow_server_url: bool,
    interpolation: JsonInterpolation,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<BTreeMap<String, McpServerConfig>, String> {
    let servers = value
        .as_object()
        .ok_or_else(|| format!("{label} MCP config field 'mcpServers' must be an object."))?;
    servers
        .iter()
        .map(|(name, value)| {
            parse_json_server(
                name,
                value,
                label,
                allow_server_url,
                interpolation,
                env_lookup,
            )
            .map(|server| (server.name.clone(), server))
        })
        .collect()
}

fn parse_json_server(
    name: &str,
    value: &JsonValue,
    label: &str,
    allow_server_url: bool,
    interpolation: JsonInterpolation,
    env_lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<McpServerConfig, String> {
    let server = value
        .as_object()
        .ok_or_else(|| format!("{label} MCP server '{name}' must be a JSON object."))?;
    let transport_type = optional_json_string(server, "type", label, name)?;
    let command = optional_json_string(server, "command", label, name)?
        .map(|value| {
            interpolate_json_string(&value, interpolation, env_lookup, label, name, "command")
        })
        .transpose()?;
    let (url, url_field) = match optional_json_string(server, "url", label, name)? {
        Some(url) => (Some(url), "url"),
        None if allow_server_url => (
            optional_json_string(server, "serverUrl", label, name)?,
            "serverUrl",
        ),
        None => (None, "url"),
    };
    let url = url
        .map(|value| {
            interpolate_json_string(&value, interpolation, env_lookup, label, name, url_field)
        })
        .transpose()?;
    let args = optional_json_string_array(server, "args", label, name)?
        .unwrap_or_default()
        .into_iter()
        .map(|value| {
            interpolate_json_string(&value, interpolation, env_lookup, label, name, "args")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let env = optional_json_string_map(server, "env", label, name)?
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| {
            interpolate_json_string(&value, interpolation, env_lookup, label, name, "env")
                .map(|value| (key, value))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let headers = optional_json_string_map(server, "headers", label, name)?
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| {
            interpolate_json_string(&value, interpolation, env_lookup, label, name, "headers")
                .map(|value| (key, value))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let enabled = match optional_json_bool(server, "enabled", label, name)? {
        Some(enabled) => enabled,
        None => !optional_json_bool(server, "disabled", label, name)?.unwrap_or(false),
    };
    let transport = match transport_type.as_deref() {
        Some("stdio") => McpServerTransport::Stdio {
            command: command.ok_or_else(|| {
                format!("{label} MCP server '{name}' requires string field 'command'.")
            })?,
            args,
            env,
        },
        Some("http" | "sse" | "streamable-http") => McpServerTransport::Remote {
            url: url.ok_or_else(|| {
                format!("{label} MCP server '{name}' requires string field 'url'.")
            })?,
            headers,
        },
        Some(_) => {
            return Err(format!(
                "{label} MCP server '{name}' has an unsupported transport type."
            ))
        }
        None if command.is_some() => McpServerTransport::Stdio {
            command: command.unwrap(),
            args,
            env,
        },
        None if url.is_some() => McpServerTransport::Remote {
            url: url.unwrap(),
            headers,
        },
        None => {
            return Err(format!(
                "{label} MCP server '{name}' requires 'command' or 'url'."
            ))
        }
    };
    super::client::normalize_server_config(McpServerConfig {
        name: name.into(),
        enabled,
        transport,
    })
    .map_err(|error| format!("{label} MCP server '{name}' is invalid: {error}"))
}

fn interpolate_json_string(
    value: &str,
    interpolation: JsonInterpolation,
    env_lookup: &dyn Fn(&str) -> Option<String>,
    label: &str,
    name: &str,
    field: &str,
) -> Result<String, String> {
    let marker = match interpolation {
        JsonInterpolation::None => return Ok(value.to_string()),
        JsonInterpolation::ClaudeCode => "${",
        JsonInterpolation::Environment => "${env:",
    };
    let mut result = String::with_capacity(value.len());
    let mut cursor = 0;
    while let Some(relative_start) = value[cursor..].find(marker) {
        let start = cursor + relative_start;
        result.push_str(&value[cursor..start]);
        let expression_start = start + marker.len();
        let Some(relative_end) = value[expression_start..].find('}') else {
            result.push_str(&value[start..]);
            return Ok(result);
        };
        let end = expression_start + relative_end;
        let expression = &value[expression_start..end];
        let (variable, default) = match interpolation {
            JsonInterpolation::None => unreachable!(),
            JsonInterpolation::ClaudeCode => match expression.split_once(":-") {
                Some((variable, default)) => (variable, Some(default)),
                None => (expression, None),
            },
            JsonInterpolation::Environment => (expression, None),
        };
        if !is_environment_variable_name(variable) {
            result.push_str(&value[start..=end]);
            cursor = end + 1;
            continue;
        }
        match env_lookup(variable).or_else(|| default.map(str::to_owned)) {
            Some(replacement) => result.push_str(&replacement),
            None => {
                return Err(format!(
                    "{label} MCP server '{name}' field '{field}' references unset environment variable '{variable}'."
                ));
            }
        }
        cursor = end + 1;
    }
    result.push_str(&value[cursor..]);
    Ok(result)
}

fn is_environment_variable_name(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some('_' | 'A'..='Z' | 'a'..='z'))
        && characters.all(|character| matches!(character, '_' | 'A'..='Z' | 'a'..='z' | '0'..='9'))
}

fn optional_json_string(
    object: &JsonMap<String, JsonValue>,
    field: &str,
    label: &str,
    name: &str,
) -> Result<Option<String>, String> {
    object
        .get(field)
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                format!("{label} MCP server '{name}' field '{field}' must be a string.")
            })
        })
        .transpose()
}

fn optional_json_bool(
    object: &JsonMap<String, JsonValue>,
    field: &str,
    label: &str,
    name: &str,
) -> Result<Option<bool>, String> {
    object
        .get(field)
        .map(|value| {
            value.as_bool().ok_or_else(|| {
                format!("{label} MCP server '{name}' field '{field}' must be a boolean.")
            })
        })
        .transpose()
}

fn optional_json_string_array(
    object: &JsonMap<String, JsonValue>,
    field: &str,
    label: &str,
    name: &str,
) -> Result<Option<Vec<String>>, String> {
    object
        .get(field)
        .map(|value| {
            value
                .as_array()
                .ok_or_else(|| {
                    format!("{label} MCP server '{name}' field '{field}' must be an array of strings.")
                })?
                .iter()
                .map(|entry| {
                    entry.as_str().map(str::to_owned).ok_or_else(|| {
                        format!("{label} MCP server '{name}' field '{field}' must be an array of strings.")
                    })
                })
                .collect()
        })
        .transpose()
}

fn optional_json_string_map(
    object: &JsonMap<String, JsonValue>,
    field: &str,
    label: &str,
    name: &str,
) -> Result<Option<BTreeMap<String, String>>, String> {
    object
        .get(field)
        .map(|value| {
            value
                .as_object()
                .ok_or_else(|| {
                    format!("{label} MCP server '{name}' field '{field}' must be an object of string values.")
                })?
                .iter()
                .map(|(key, value)| {
                    value
                        .as_str()
                        .map(|value| (key.clone(), value.to_owned()))
                        .ok_or_else(|| {
                            format!("{label} MCP server '{name}' field '{field}' must be an object of string values.")
                        })
                })
                .collect()
        })
        .transpose()
}

fn parse_codex_servers<F>(
    contents: &str,
    env_lookup: &F,
) -> Result<BTreeMap<String, McpServerConfig>, String>
where
    F: Fn(&str) -> Option<String>,
{
    let root = contents
        .parse::<toml::Value>()
        .map_err(|error| codex_toml_error(contents, error))?;
    let root = root
        .as_table()
        .ok_or_else(|| "Codex MCP config must be a TOML table.".to_string())?;
    let Some(servers) = root.get("mcp_servers") else {
        return Ok(BTreeMap::new());
    };
    let servers = servers
        .as_table()
        .ok_or_else(|| "Codex MCP config field 'mcp_servers' must be a table.".to_string())?;
    servers
        .iter()
        .map(|(name, value)| {
            parse_codex_server(name, value, env_lookup).map(|server| (server.name.clone(), server))
        })
        .collect()
}

fn parse_codex_server<F>(
    name: &str,
    value: &toml::Value,
    env_lookup: &F,
) -> Result<McpServerConfig, String>
where
    F: Fn(&str) -> Option<String>,
{
    let server = value
        .as_table()
        .ok_or_else(|| format!("Codex MCP server '{name}' must be a TOML table."))?;
    let command = optional_toml_string(server, "command", name)?;
    let url = optional_toml_string(server, "url", name)?;
    let args = optional_toml_string_array(server, "args", name)?.unwrap_or_default();
    let mut env = optional_toml_string_map(server, "env", name)?.unwrap_or_default();
    for (variable, local) in optional_codex_env_vars(server, name)? {
        if local {
            if let Some(value) = env_lookup(&variable) {
                env.insert(variable, value);
            }
        }
    }
    let mut headers = optional_toml_string_map(server, "headers", name)?.unwrap_or_default();
    headers.extend(optional_toml_string_map(server, "http_headers", name)?.unwrap_or_default());
    for (header, variable) in
        optional_toml_string_map(server, "env_http_headers", name)?.unwrap_or_default()
    {
        if let Some(value) = env_lookup(&variable) {
            headers.insert(header, value);
        }
    }
    if let Some(variable) = optional_toml_string(server, "bearer_token_env_var", name)? {
        if let Some(value) = env_lookup(&variable) {
            headers.insert("Authorization".into(), format!("Bearer {value}"));
        }
    }
    let transport = match (command, url) {
        (Some(command), None) => McpServerTransport::Stdio { command, args, env },
        (None, Some(url)) => McpServerTransport::Remote { url, headers },
        (Some(_), Some(_)) => {
            return Err(format!(
                "Codex MCP server '{name}' cannot contain both 'command' and 'url'."
            ))
        }
        (None, None) => {
            return Err(format!(
                "Codex MCP server '{name}' requires 'command' or 'url'."
            ))
        }
    };
    super::client::normalize_server_config(McpServerConfig {
        name: name.into(),
        enabled: optional_toml_bool(server, "enabled", name)?.unwrap_or(true),
        transport,
    })
    .map_err(|error| format!("Codex MCP server '{name}' is invalid: {error}"))
}

fn codex_toml_error(contents: &str, error: toml::de::Error) -> String {
    let Some(span) = error.span() else {
        return "Codex MCP config is invalid TOML.".to_string();
    };
    let offset = span.start.min(contents.len());
    let prefix = &contents[..offset];
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let line_start = prefix.rfind('\n').map_or(0, |index| index + 1);
    let column = prefix[line_start..].chars().count() + 1;
    format!("Codex MCP config is invalid TOML at line {line} column {column}.")
}

fn optional_toml_bool(
    table: &toml::Table,
    field: &str,
    name: &str,
) -> Result<Option<bool>, String> {
    table
        .get(field)
        .map(|value| {
            value.as_bool().ok_or_else(|| {
                format!("Codex MCP server '{name}' field '{field}' must be a boolean.")
            })
        })
        .transpose()
}

fn optional_codex_env_vars(table: &toml::Table, name: &str) -> Result<Vec<(String, bool)>, String> {
    let Some(value) = table.get("env_vars") else {
        return Ok(Vec::new());
    };
    let entries = value.as_array().ok_or_else(|| {
        format!(
            "Codex MCP server '{name}' field 'env_vars' must be an array of names or reference tables."
        )
    })?;
    entries
        .iter()
        .map(|entry| {
            if let Some(variable) = entry.as_str() {
                return Ok((variable.to_string(), true));
            }
            let reference = entry.as_table().ok_or_else(|| {
                format!(
                    "Codex MCP server '{name}' field 'env_vars' must be an array of names or reference tables."
                )
            })?;
            let variable = reference
                .get("name")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| {
                    format!(
                        "Codex MCP server '{name}' field 'env_vars' reference requires string field 'name'."
                    )
                })?;
            let local = match reference.get("source").map(toml::Value::as_str) {
                None | Some(Some("local")) => true,
                Some(Some("remote")) => false,
                _ => {
                    return Err(format!(
                        "Codex MCP server '{name}' field 'env_vars' reference source must be 'local' or 'remote'."
                    ));
                }
            };
            Ok((variable.to_string(), local))
        })
        .collect()
}

fn optional_toml_string(
    table: &toml::Table,
    field: &str,
    name: &str,
) -> Result<Option<String>, String> {
    table
        .get(field)
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                format!("Codex MCP server '{name}' field '{field}' must be a string.")
            })
        })
        .transpose()
}

fn optional_toml_string_array(
    table: &toml::Table,
    field: &str,
    name: &str,
) -> Result<Option<Vec<String>>, String> {
    table
        .get(field)
        .map(|value| {
            value
                .as_array()
                .ok_or_else(|| {
                    format!("Codex MCP server '{name}' field '{field}' must be an array of strings.")
                })?
                .iter()
                .map(|entry| {
                    entry.as_str().map(str::to_owned).ok_or_else(|| {
                        format!("Codex MCP server '{name}' field '{field}' must be an array of strings.")
                    })
                })
                .collect()
        })
        .transpose()
}

fn optional_toml_string_map(
    table: &toml::Table,
    field: &str,
    name: &str,
) -> Result<Option<BTreeMap<String, String>>, String> {
    table
        .get(field)
        .map(|value| {
            value
                .as_table()
                .ok_or_else(|| {
                    format!("Codex MCP server '{name}' field '{field}' must be a table of string values.")
                })?
                .iter()
                .map(|(key, value)| {
                    value
                        .as_str()
                        .map(|value| (key.clone(), value.to_owned()))
                        .ok_or_else(|| {
                            format!("Codex MCP server '{name}' field '{field}' must be a table of string values.")
                        })
                })
                .collect()
        })
        .transpose()
}

#[tauri::command]
pub async fn mcp_import_source<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, super::server::McpState>,
    source_tool: String,
) -> Result<Vec<ImportedMcpServer>, String> {
    super::client::validate_command_webview(webview.label(), webview.window().label())?;
    let source = SourceTool::parse(&source_tool)?;
    let home = crate::paths::home_dir()?;
    let project_root = if matches!(source, SourceTool::ClaudeCode | SourceTool::Cursor) {
        state
            .active_project
            .lock()
            .await
            .as_deref()
            .map(crate::paths::project_dir)
            .transpose()?
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        import_source_at(&source_tool, &home, project_root.as_deref(), &|name| {
            std::env::var(name).ok()
        })
    })
    .await
    .map_err(|_| "MCP source import could not be completed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::McpServerTransport;
    use std::collections::BTreeMap;
    use std::path::Path;

    const CLAUDE_DESKTOP_FIXTURE: &str = include_str!("fixtures/source_import_claude_desktop.json");
    const CODEX_FIXTURE: &str = include_str!("fixtures/source_import_codex.toml");
    const CURSOR_FIXTURE: &str = include_str!("fixtures/source_import_cursor.json");

    fn write_source(home: &Path, relative: &str, contents: &str) {
        let path = home.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn fixture_env(name: &str) -> Option<String> {
        match name {
            "CLAUDE_ARG" => Some("claude-arg-value".into()),
            "CLAUDE_COMMAND" => Some("/opt/claude/mcp-server".into()),
            "CLAUDE_TOKEN" => Some("claude-interpolated-token".into()),
            "CLAUDE_URL" => Some("https://claude.example.com".into()),
            "CODEX_BEARER" => Some("codex-bearer-value".into()),
            "CODEX_FORWARDED" => Some("codex-forwarded-value".into()),
            "CODEX_HEADER" => Some("codex-header-value".into()),
            "CURSOR_ARG" => Some("cursor-arg-value".into()),
            "CURSOR_COMMAND" => Some("/opt/cursor/mcp-server".into()),
            "CURSOR_TOKEN" => Some("cursor-interpolated-token".into()),
            "CURSOR_URL" => Some("https://cursor.example.com".into()),
            "WINDSURF_ARG" => Some("windsurf-arg-value".into()),
            "WINDSURF_COMMAND" => Some("/opt/windsurf/mcp-server".into()),
            "WINDSURF_TOKEN" => Some("windsurf-interpolated-token".into()),
            "WINDSURF_URL" => Some("https://windsurf.example.com".into()),
            _ => None,
        }
    }

    #[test]
    fn claude_code_interpolates_documented_fields_and_defaults() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            ".claude.json",
            r#"{
                "mcpServers": {
                    "remote": {
                        "type": "http",
                        "url": "${CLAUDE_URL}/mcp",
                        "headers": {
                            "Authorization": "Bearer ${CLAUDE_TOKEN}",
                            "X-Region": "${CLAUDE_REGION:-local}"
                        }
                    },
                    "stdio": {
                        "command": "${CLAUDE_COMMAND}",
                        "args": ["--label=${CLAUDE_ARG}", "${CLAUDE_MODE:-safe}"],
                        "env": {
                            "ACCESS_TOKEN": "prefix-${CLAUDE_TOKEN}"
                        }
                    }
                }
            }"#,
        );

        let imported = import_source_at("claude-code", home.path(), None, &fixture_env).unwrap();

        assert_eq!(imported.len(), 2);
        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Remote {
                url: "https://claude.example.com/mcp".into(),
                headers: BTreeMap::from([
                    (
                        "Authorization".into(),
                        "Bearer claude-interpolated-token".into()
                    ),
                    ("X-Region".into(), "local".into()),
                ]),
            }
        );
        assert_eq!(
            imported[1].server.transport,
            McpServerTransport::Stdio {
                command: "/opt/claude/mcp-server".into(),
                args: vec!["--label=claude-arg-value".into(), "safe".into()],
                env: BTreeMap::from([(
                    "ACCESS_TOKEN".into(),
                    "prefix-claude-interpolated-token".into()
                )]),
            }
        );
    }

    #[test]
    fn claude_code_missing_required_variable_reports_field_without_values() {
        let home = tempfile::tempdir().unwrap();
        let secret = "literal-secret-that-must-not-leak";
        write_source(
            home.path(),
            ".claude.json",
            &format!(
                r#"{{"mcpServers":{{"remote":{{"type":"http","url":"https://mcp.example.com","headers":{{"Authorization":"Bearer ${{MISSING_CLAUDE_TOKEN}}","X-Secret":"{secret}"}}}}}}}}"#
            ),
        );

        let error = import_source_at("claude-code", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(
            error,
            "Claude Code MCP server 'remote' field 'headers' references unset environment variable 'MISSING_CLAUDE_TOKEN'."
        );
        assert!(!error.contains(secret));
        assert!(!error.contains("claude-interpolated-token"));
    }

    #[test]
    fn windsurf_interpolates_only_its_documented_environment_syntax() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            ".codeium/windsurf/mcp_config.json",
            r#"{
                "mcpServers": {
                    "remote": {
                        "serverUrl": "${env:WINDSURF_URL}/mcp",
                        "headers": {
                            "Authorization": "Bearer ${env:WINDSURF_TOKEN}",
                            "X-Literal": "${WINDSURF_TOKEN}"
                        }
                    },
                    "stdio": {
                        "command": "${env:WINDSURF_COMMAND}",
                        "args": ["--label=${env:WINDSURF_ARG}"],
                        "env": {
                            "ACCESS_TOKEN": "prefix-${env:WINDSURF_TOKEN}"
                        }
                    }
                }
            }"#,
        );

        let imported = import_source_at("windsurf", home.path(), None, &fixture_env).unwrap();

        assert_eq!(imported.len(), 2);
        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Remote {
                url: "https://windsurf.example.com/mcp".into(),
                headers: BTreeMap::from([
                    (
                        "Authorization".into(),
                        "Bearer windsurf-interpolated-token".into()
                    ),
                    ("X-Literal".into(), "${WINDSURF_TOKEN}".into()),
                ]),
            }
        );
        assert_eq!(
            imported[1].server.transport,
            McpServerTransport::Stdio {
                command: "/opt/windsurf/mcp-server".into(),
                args: vec!["--label=windsurf-arg-value".into()],
                env: BTreeMap::from([(
                    "ACCESS_TOKEN".into(),
                    "prefix-windsurf-interpolated-token".into()
                )]),
            }
        );
    }

    #[test]
    fn windsurf_missing_required_variable_reports_field_without_values() {
        let home = tempfile::tempdir().unwrap();
        let secret = "literal-secret-that-must-not-leak";
        write_source(
            home.path(),
            ".codeium/windsurf/mcp_config.json",
            &format!(
                r#"{{"mcpServers":{{"stdio":{{"command":"node","args":["--token=${{env:MISSING_WINDSURF_TOKEN}}"],"env":{{"LITERAL":"{secret}"}}}}}}}}"#
            ),
        );

        let error = import_source_at("windsurf", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(
            error,
            "Windsurf MCP server 'stdio' field 'args' references unset environment variable 'MISSING_WINDSURF_TOKEN'."
        );
        assert!(!error.contains(secret));
        assert!(!error.contains("windsurf-interpolated-token"));
    }

    #[test]
    fn cursor_interpolates_documented_environment_syntax() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            ".cursor/mcp.json",
            r#"{
                "mcpServers": {
                    "remote": {
                        "url": "${env:CURSOR_URL}/mcp",
                        "headers": {
                            "Authorization": "Bearer ${env:CURSOR_TOKEN}"
                        }
                    },
                    "stdio": {
                        "command": "${env:CURSOR_COMMAND}",
                        "args": ["--label=${env:CURSOR_ARG}"],
                        "env": {
                            "ACCESS_TOKEN": "prefix-${env:CURSOR_TOKEN}"
                        }
                    }
                }
            }"#,
        );

        let imported = import_source_at("cursor", home.path(), None, &fixture_env).unwrap();

        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Remote {
                url: "https://cursor.example.com/mcp".into(),
                headers: BTreeMap::from([(
                    "Authorization".into(),
                    "Bearer cursor-interpolated-token".into()
                )]),
            }
        );
        assert_eq!(
            imported[1].server.transport,
            McpServerTransport::Stdio {
                command: "/opt/cursor/mcp-server".into(),
                args: vec!["--label=cursor-arg-value".into()],
                env: BTreeMap::from([(
                    "ACCESS_TOKEN".into(),
                    "prefix-cursor-interpolated-token".into()
                )]),
            }
        );
    }

    #[test]
    fn cursor_missing_required_variable_reports_field_without_values() {
        let home = tempfile::tempdir().unwrap();
        let secret = "literal-secret-that-must-not-leak";
        write_source(
            home.path(),
            ".cursor/mcp.json",
            &format!(
                r#"{{"mcpServers":{{"remote":{{"url":"https://mcp.example.com","headers":{{"Authorization":"Bearer ${{env:MISSING_CURSOR_TOKEN}}","X-Secret":"{secret}"}}}}}}}}"#
            ),
        );

        let error = import_source_at("cursor", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(
            error,
            "Cursor MCP server 'remote' field 'headers' references unset environment variable 'MISSING_CURSOR_TOKEN'."
        );
        assert!(!error.contains(secret));
        assert!(!error.contains("cursor-interpolated-token"));
    }

    #[test]
    fn claude_desktop_leaves_placeholders_literal() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            "Library/Application Support/Claude/claude_desktop_config.json",
            r#"{"mcpServers":{"desktop":{"command":"${CLAUDE_COMMAND}","env":{"TOKEN":"${CLAUDE_TOKEN}"}}}}"#,
        );

        let desktop = import_source_at("claude-desktop", home.path(), None, &fixture_env).unwrap();

        assert_eq!(
            desktop[0].server.transport,
            McpServerTransport::Stdio {
                command: "${CLAUDE_COMMAND}".into(),
                args: Vec::new(),
                env: BTreeMap::from([("TOKEN".into(), "${CLAUDE_TOKEN}".into())]),
            }
        );
    }

    #[test]
    fn imports_claude_desktop_fixture_as_normalized_stdio() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            "Library/Application Support/Claude/claude_desktop_config.json",
            CLAUDE_DESKTOP_FIXTURE,
        );

        let imported = import_source_at("claude-desktop", home.path(), None, &fixture_env).unwrap();

        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].source_tool, "claude-desktop");
        assert_eq!(imported[0].server.name, "filesystem");
        assert!(imported[0].server.enabled);
        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Stdio {
                command: "npx".into(),
                args: vec![
                    "-y".into(),
                    "@modelcontextprotocol/server-filesystem".into(),
                    "/tmp/library".into(),
                ],
                env: BTreeMap::from([("CLAUDE_TOKEN".into(), "claude-token-value".into())]),
            }
        );
    }

    #[test]
    fn imports_cursor_fixture_with_inferred_and_explicit_transports() {
        let home = tempfile::tempdir().unwrap();
        write_source(home.path(), ".cursor/mcp.json", CURSOR_FIXTURE);

        let imported = import_source_at("cursor", home.path(), None, &fixture_env).unwrap();

        assert_eq!(imported.len(), 2);
        assert_eq!(imported[0].source_tool, "cursor");
        assert_eq!(imported[0].server.name, "docs-api");
        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Remote {
                url: "https://mcp.example.com/cursor".into(),
                headers: BTreeMap::from([(
                    "Authorization".into(),
                    "Bearer cursor-token-value".into()
                )]),
            }
        );
        assert_eq!(imported[1].server.name, "local-search");
        assert_eq!(
            imported[1].server.transport,
            McpServerTransport::Stdio {
                command: "uvx".into(),
                args: vec!["mcp-server-search".into()],
                env: BTreeMap::from([("MODE".into(), "safe".into())]),
            }
        );
    }

    #[test]
    fn imports_codex_fixture_with_literal_and_forwarded_values() {
        let home = tempfile::tempdir().unwrap();
        write_source(home.path(), ".codex/config.toml", CODEX_FIXTURE);

        let imported = import_source_at("codex", home.path(), None, &fixture_env).unwrap();

        assert_eq!(imported.len(), 2);
        assert_eq!(imported[0].source_tool, "codex");
        assert_eq!(imported[0].server.name, "remote-api");
        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Remote {
                url: "https://mcp.example.com/codex".into(),
                headers: BTreeMap::from([
                    ("Authorization".into(), "Bearer codex-bearer-value".into()),
                    ("X-Alias".into(), "alias-value".into()),
                    ("X-Forwarded".into(), "codex-header-value".into()),
                    ("X-Literal".into(), "literal-value".into()),
                ]),
            }
        );
        assert_eq!(imported[1].server.name, "stdio-tool");
        assert_eq!(
            imported[1].server.transport,
            McpServerTransport::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "@example/codex-mcp".into()],
                env: BTreeMap::from([
                    ("CODEX_FORWARDED".into(), "codex-forwarded-value".into()),
                    ("LITERAL".into(), "literal-value".into()),
                ]),
            }
        );
    }

    #[test]
    fn imports_current_codex_enabled_and_environment_reference_forms() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            ".codex/config.toml",
            r#"[mcp_servers.mixed-env]
command = "node"
enabled = false
env_vars = ["CODEX_FORWARDED", { name = "CODEX_HEADER", source = "local" }, { name = "REMOTE_ONLY", source = "remote" }]
"#,
        );

        let imported = import_source_at("codex", home.path(), None, &fixture_env).unwrap();

        assert!(!imported[0].server.enabled);
        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Stdio {
                command: "node".into(),
                args: Vec::new(),
                env: BTreeMap::from([
                    ("CODEX_FORWARDED".into(), "codex-forwarded-value".into()),
                    ("CODEX_HEADER".into(), "codex-header-value".into()),
                ]),
            }
        );
    }

    #[test]
    fn malformed_codex_toml_reports_a_location_without_source_values() {
        let home = tempfile::tempdir().unwrap();
        let secret = "do-not-expose-codex-secret";
        write_source(
            home.path(),
            ".codex/config.toml",
            &format!("[mcp_servers.broken]\ncommand = \"node\"\nenv = {{ TOKEN = \"{secret}\"\n"),
        );

        let error = import_source_at("codex", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(
            error,
            "Codex MCP config is invalid TOML at line 3 column 45."
        );
        assert!(!error.contains(secret));
        assert!(!error.contains(&home.path().display().to_string()));
    }

    #[test]
    fn missing_source_returns_an_empty_list() {
        let home = tempfile::tempdir().unwrap();

        let imported = import_source_at("claude-desktop", home.path(), None, &fixture_env).unwrap();

        assert!(imported.is_empty());
    }

    #[test]
    fn malformed_source_error_names_the_field_without_exposing_its_value() {
        let home = tempfile::tempdir().unwrap();
        let secret = "do-not-expose-this-value";
        write_source(
            home.path(),
            ".cursor/mcp.json",
            &format!(
                r#"{{"mcpServers":{{"broken":{{"command":"npx","env":{{"TOKEN":["{secret}"]}}}}}}}}"#
            ),
        );

        let error = import_source_at("cursor", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(
            error,
            "Cursor MCP server 'broken' field 'env' must be an object of string values."
        );
        assert!(!error.contains(secret));
        assert!(!error.contains(&home.path().display().to_string()));
    }

    #[test]
    fn unknown_source_tool_is_rejected_before_reading_files() {
        let home = tempfile::tempdir().unwrap();

        let error = import_source_at("../../other", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(
            error,
            "Unsupported MCP source tool. Expected claude-desktop, claude-code, codex, cursor, or windsurf."
        );
        assert!(!error.contains("../../other"));
    }

    #[test]
    fn claude_code_uses_local_scope_over_project_file_over_user_scope() {
        let home = tempfile::tempdir().unwrap();
        let project = home.path().join("active-project");
        std::fs::create_dir(&project).unwrap();
        let project = project.canonicalize().unwrap();
        let project_key = project.display().to_string();
        let user_config = serde_json::json!({
            "mcpServers": {
                "shared": { "command": "user-command" },
                "user-only": { "command": "user-only-command" }
            },
            "projects": {
                project_key: {
                    "mcpServers": {
                        "shared": { "command": "local-command" },
                        "local-only": { "command": "local-only-command" }
                    }
                }
            }
        });
        write_source(
            home.path(),
            ".claude.json",
            &serde_json::to_string(&user_config).unwrap(),
        );
        std::fs::write(
            project.join(".mcp.json"),
            serde_json::to_vec(&serde_json::json!({
                "mcpServers": {
                    "shared": { "command": "project-command" },
                    "project-only": { "command": "project-only-command" }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let imported =
            import_source_at("claude-code", home.path(), Some(&project), &fixture_env).unwrap();

        assert_eq!(
            imported
                .iter()
                .map(|item| item.server.name.as_str())
                .collect::<Vec<_>>(),
            vec!["local-only", "project-only", "shared", "user-only"]
        );
        let shared = imported
            .iter()
            .find(|item| item.server.name == "shared")
            .unwrap();
        assert_eq!(
            shared.server.transport,
            McpServerTransport::Stdio {
                command: "local-command".into(),
                args: Vec::new(),
                env: BTreeMap::new(),
            }
        );
    }

    #[test]
    fn cursor_project_config_overrides_global_config() {
        let home = tempfile::tempdir().unwrap();
        let project = home.path().join("active-project");
        std::fs::create_dir(&project).unwrap();
        write_source(
            home.path(),
            ".cursor/mcp.json",
            r#"{"mcpServers":{"shared":{"command":"global-command"}}}"#,
        );
        write_source(
            &project,
            ".cursor/mcp.json",
            r#"{"mcpServers":{"shared":{"command":"project-command"}}}"#,
        );

        let imported =
            import_source_at("cursor", home.path(), Some(&project), &fixture_env).unwrap();

        assert_eq!(imported.len(), 1);
        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Stdio {
                command: "project-command".into(),
                args: Vec::new(),
                env: BTreeMap::new(),
            }
        );
    }

    #[test]
    fn missing_mcp_servers_map_returns_an_empty_list() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            "Library/Application Support/Claude/claude_desktop_config.json",
            r#"{"other":true}"#,
        );

        let imported = import_source_at("claude-desktop", home.path(), None, &fixture_env).unwrap();

        assert!(imported.is_empty());
    }

    #[test]
    fn supports_http_sse_and_streamable_http_transport_types() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            ".cursor/mcp.json",
            r#"{"mcpServers":{"http":{"type":"http","url":"https://mcp.example.com/http"},"sse":{"type":"sse","url":"https://mcp.example.com/sse"},"streamable":{"type":"streamable-http","url":"https://mcp.example.com/streamable"}}}"#,
        );

        let imported = import_source_at("cursor", home.path(), None, &fixture_env).unwrap();

        assert_eq!(imported.len(), 3);
        assert!(imported
            .iter()
            .all(|item| matches!(item.server.transport, McpServerTransport::Remote { .. })));
    }

    #[test]
    fn windsurf_server_url_is_normalized_as_remote() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            ".codeium/windsurf/mcp_config.json",
            r#"{"mcpServers":{"windsurf-api":{"serverUrl":"https://mcp.example.com/windsurf","headers":{"X-Token":"windsurf-token"}}}}"#,
        );

        let imported = import_source_at("windsurf", home.path(), None, &fixture_env).unwrap();

        assert_eq!(
            imported[0].server.transport,
            McpServerTransport::Remote {
                url: "https://mcp.example.com/windsurf".into(),
                headers: BTreeMap::from([("X-Token".into(), "windsurf-token".into())]),
            }
        );
    }

    #[test]
    fn serialized_result_is_flat_and_uses_source_tool_camel_case() {
        let home = tempfile::tempdir().unwrap();
        write_source(
            home.path(),
            "Library/Application Support/Claude/claude_desktop_config.json",
            CLAUDE_DESKTOP_FIXTURE,
        );
        let imported = import_source_at("claude-desktop", home.path(), None, &fixture_env).unwrap();

        let value = serde_json::to_value(&imported[0]).unwrap();

        assert_eq!(value["sourceTool"], "claude-desktop");
        assert_eq!(value["name"], "filesystem");
        assert_eq!(value["transport"], "stdio");
        assert_eq!(value["command"], "npx");
        assert!(value.get("server").is_none());
        assert!(value.get("source_tool").is_none());
    }

    #[test]
    fn traversal_source_path_is_rejected() {
        let home = tempfile::tempdir().unwrap();

        let error =
            read_source_file(home.path(), Path::new("../outside.json"), "Cursor").unwrap_err();

        assert_eq!(error, "Cursor MCP source path is not confined.");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_source_component_is_rejected() {
        let home = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(
            outside.path().join("mcp.json"),
            r#"{"mcpServers":{"escaped":{"command":"escaped"}}}"#,
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), home.path().join(".cursor")).unwrap();

        let error = import_source_at("cursor", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(error, "Cursor MCP source path contains a symbolic link.");
    }

    #[cfg(unix)]
    #[test]
    fn directory_swap_before_file_open_cannot_redirect_the_read() {
        let home = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source_dir = home.path().join(".cursor");
        let pinned_dir = home.path().join(".cursor-pinned");
        std::fs::create_dir(&source_dir).unwrap();
        std::fs::write(source_dir.join("mcp.json"), "inside-root").unwrap();
        std::fs::write(outside.path().join("mcp.json"), "outside-root").unwrap();

        let contents = read_source_file_with_hook(
            home.path(),
            Path::new(".cursor/mcp.json"),
            "Cursor",
            || {
                std::fs::rename(&source_dir, &pinned_dir).unwrap();
                std::os::unix::fs::symlink(outside.path(), &source_dir).unwrap();
            },
        )
        .unwrap();

        assert_eq!(contents.as_deref(), Some("inside-root"));
    }

    #[test]
    fn oversized_source_is_rejected_before_parsing() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".cursor/mcp.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, vec![b' '; MAX_SOURCE_BYTES as usize + 1]).unwrap();

        let error = import_source_at("cursor", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(
            error,
            format!("Cursor MCP source exceeds the {MAX_SOURCE_BYTES} byte limit.")
        );
    }

    #[test]
    fn non_file_source_is_rejected() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".cursor/mcp.json")).unwrap();

        let error = import_source_at("cursor", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(error, "Cursor MCP source is not a regular file.");
    }

    #[cfg(unix)]
    #[test]
    fn special_source_is_rejected_before_opening() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".cursor/mcp.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let _listener = std::os::unix::net::UnixListener::bind(path).unwrap();

        let error = import_source_at("cursor", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(error, "Cursor MCP source is not a regular file.");
    }

    #[test]
    fn invalid_utf8_source_is_rejected() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".cursor/mcp.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, [0xff, 0xfe]).unwrap();

        let error = import_source_at("cursor", home.path(), None, &fixture_env).unwrap_err();

        assert_eq!(error, "Cursor MCP source is not valid UTF-8.");
    }
}
