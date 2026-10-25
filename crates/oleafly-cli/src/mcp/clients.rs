//! Where AI clients keep their MCP server lists, and the `oleafly` entry
//! each needs. Writes keep every other server and setting, back the file up
//! first, and never include tokens or secrets.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use clap::ValueEnum;
use serde_json::{json, Value};

use crate::app_paths::Platform;
use crate::contract::{CliError, ErrorKind};

const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;
pub const BACKUP_SUFFIX: &str = ".oleafly-backup";
pub const TOOL_TIMEOUT_SECONDS: u64 = 300;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Client {
    ClaudeCode,
    ClaudeDesktop,
    Codex,
    Cursor,
    Gemini,
}

impl Client {
    pub const ALL: [Client; 5] = [
        Client::ClaudeCode,
        Client::ClaudeDesktop,
        Client::Codex,
        Client::Cursor,
        Client::Gemini,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::ClaudeDesktop => "Claude Desktop",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor",
            Self::Gemini => "Gemini CLI",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::ClaudeDesktop => "claude-desktop",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::Gemini => "gemini",
        }
    }

    fn toml(self) -> bool {
        self == Self::Codex
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Scope {
    Project,
    User,
}

impl Scope {
    pub fn label(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::User => "user",
        }
    }
}

/// Where this computer keeps things.
#[derive(Clone, Debug)]
pub struct ClientEnv {
    pub platform: Platform,
    pub home: PathBuf,
    pub app_data: Option<PathBuf>,
    pub xdg_config: Option<PathBuf>,
    pub codex_home: Option<PathBuf>,
}

impl ClientEnv {
    pub fn from_env() -> ClientEnv {
        let var = |name: &str| {
            std::env::var_os(name)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        };
        ClientEnv {
            platform: Platform::current(),
            home: var("HOME")
                .or_else(|| var("USERPROFILE"))
                .unwrap_or_default(),
            app_data: var("APPDATA"),
            xdg_config: var("XDG_CONFIG_HOME"),
            codex_home: var("CODEX_HOME"),
        }
    }
}

/// The file a client keeps its servers in for `scope`, if it has one.
pub fn client_config_path(
    client: Client,
    scope: Scope,
    env: &ClientEnv,
    root: &Path,
) -> Option<PathBuf> {
    match (client, scope) {
        (Client::ClaudeCode, Scope::Project) => Some(root.join(".mcp.json")),
        (Client::ClaudeCode, Scope::User) => None,
        (Client::ClaudeDesktop, Scope::Project) => None,
        (Client::ClaudeDesktop, Scope::User) => Some(match env.platform {
            Platform::MacOs => env
                .home
                .join("Library/Application Support/Claude/claude_desktop_config.json"),
            Platform::Windows => env
                .app_data
                .clone()
                .unwrap_or_else(|| env.home.join("AppData").join("Roaming"))
                .join("Claude")
                .join("claude_desktop_config.json"),
            Platform::Linux => env
                .xdg_config
                .clone()
                .unwrap_or_else(|| env.home.join(".config"))
                .join("Claude")
                .join("claude_desktop_config.json"),
        }),
        (Client::Codex, Scope::Project) => Some(root.join(".codex").join("config.toml")),
        (Client::Codex, Scope::User) => Some(
            env.codex_home
                .clone()
                .unwrap_or_else(|| env.home.join(".codex"))
                .join("config.toml"),
        ),
        (Client::Cursor, Scope::Project) => Some(root.join(".cursor").join("mcp.json")),
        (Client::Cursor, Scope::User) => Some(env.home.join(".cursor").join("mcp.json")),
        (Client::Gemini, Scope::Project) => Some(root.join(".gemini").join("settings.json")),
        (Client::Gemini, Scope::User) => Some(env.home.join(".gemini").join("settings.json")),
    }
}

fn arguments(client: Client) -> Vec<&'static str> {
    match client {
        // Claude Desktop starts servers with no project folder: bridge to
        // whatever the app has open.
        Client::ClaudeDesktop => vec!["mcp", "--bridge", "always"],
        _ => vec!["mcp"],
    }
}

/// The server entry for `client` (JSON; Codex's TOML table as JSON).
pub fn entry_for(client: Client, _scope: Scope, command: &str) -> Value {
    let args = arguments(client);
    match client {
        Client::ClaudeCode => json!({"type": "stdio", "command": command, "args": args}),
        Client::Gemini => {
            json!({"command": command, "args": args, "timeout": TOOL_TIMEOUT_SECONDS * 1000})
        }
        Client::Codex => {
            json!({"command": command, "args": args, "tool_timeout_sec": TOOL_TIMEOUT_SECONDS})
        }
        Client::ClaudeDesktop | Client::Cursor => json!({"command": command, "args": args}),
    }
}

/// The entry as text to paste into the client's file.
pub fn snippet(client: Client, name: &str, entry: &Value) -> String {
    if client.toml() {
        let args: Vec<String> = entry["args"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|arg| format!("{arg}"))
            .collect();
        // A name with dots or spaces must be a quoted key.
        format!(
            "[mcp_servers.{}]\ncommand = {}\nargs = [{}]\ntool_timeout_sec = {}\n",
            toml_edit::Key::new(name),
            entry["command"],
            args.join(", "),
            entry["tool_timeout_sec"]
        )
    } else {
        serde_json::to_string_pretty(&json!({"mcpServers": {name: entry}})).unwrap_or_default()
    }
}

fn read_limited(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => Err("it isn't a regular file".into()),
        Ok(metadata) if metadata.len() > MAX_CONFIG_BYTES => Err("it is larger than 4 MiB".into()),
        Ok(_) => std::fs::read(path)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Whether the file at `path` lists a server called `name`.
fn lists_server(client: Client, path: &Path, name: &str) -> bool {
    let Ok(Some(bytes)) = read_limited(path) else {
        return false;
    };
    let text = String::from_utf8_lossy(&bytes);
    if client.toml() {
        return text
            .parse::<toml_edit::DocumentMut>()
            .ok()
            .and_then(|document| {
                document
                    .get("mcp_servers")
                    .and_then(|servers| servers.get(name))
                    .map(|_| ())
            })
            .is_some();
    }
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.get("mcpServers")?.get(name).cloned())
        .is_some()
}

/// Every client and scope whose settings list `oleafly`.
pub fn configured_clients(env: &ClientEnv, root: Option<&Path>) -> Vec<(Client, Scope, PathBuf)> {
    let mut found = Vec::new();
    for client in Client::ALL {
        for scope in [Scope::Project, Scope::User] {
            if scope == Scope::Project && root.is_none() {
                continue;
            }
            let Some(path) = client_config_path(client, scope, env, root.unwrap_or(Path::new(".")))
            else {
                continue;
            };
            if lists_server(client, &path, "oleafly") {
                found.push((client, scope, path));
            }
        }
    }
    found
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteAction {
    Added,
    Updated,
    Unchanged,
}

impl WriteAction {
    pub fn label(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Updated => "updated",
            Self::Unchanged => "unchanged",
        }
    }
}

fn unreadable(path: &Path, reason: &str, client: Client, name: &str, entry: &Value) -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "mcp.config_unreadable",
        format!(
            "Oleafly left {} alone because {reason}. Add this entry by hand:\n{}",
            path.display(),
            snippet(client, name, entry)
        ),
    )
}

fn toml_value(value: &Value) -> toml_edit::Item {
    match value {
        Value::String(text) => toml_edit::value(text.as_str()),
        Value::Number(number) => toml_edit::value(number.as_i64().unwrap_or_default()),
        Value::Bool(flag) => toml_edit::value(*flag),
        Value::Array(items) => {
            let mut array = toml_edit::Array::new();
            for item in items {
                if let Some(text) = item.as_str() {
                    array.push(text);
                }
            }
            toml_edit::value(array)
        }
        _ => toml_edit::Item::None,
    }
}

/// The new file text, and what changed.
fn updated_text(
    client: Client,
    existing: Option<&str>,
    name: &str,
    entry: &Value,
) -> Result<(String, WriteAction), String> {
    if client.toml() {
        let mut document: toml_edit::DocumentMut = existing
            .unwrap_or("")
            .parse()
            .map_err(|_| "it isn't valid TOML".to_string())?;
        let servers = document.entry("mcp_servers").or_insert(toml_edit::table());
        let servers = servers
            .as_table_mut()
            .ok_or_else(|| "its mcp_servers isn't a table".to_string())?;
        servers.set_implicit(true);
        let mut table = toml_edit::Table::new();
        for (key, value) in entry.as_object().into_iter().flatten() {
            table.insert(key, toml_value(value));
        }
        let previous = servers.get(name).map(|item| item.to_string());
        let action = match &previous {
            None => WriteAction::Added,
            Some(old) if *old == toml_edit::Item::Table(table.clone()).to_string() => {
                return Ok((
                    existing.unwrap_or_default().to_string(),
                    WriteAction::Unchanged,
                ))
            }
            Some(_) => WriteAction::Updated,
        };
        servers.insert(name, toml_edit::Item::Table(table));
        return Ok((document.to_string(), action));
    }
    let mut root: Value = match existing {
        Some(text) if !text.trim().is_empty() => {
            serde_json::from_str(text).map_err(|_| "it isn't valid JSON".to_string())?
        }
        _ => json!({}),
    };
    let object = root
        .as_object_mut()
        .ok_or_else(|| "it doesn't hold a JSON object".to_string())?;
    let servers = object.entry("mcpServers").or_insert_with(|| json!({}));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| "its mcpServers isn't an object".to_string())?;
    let action = match servers.get(name) {
        None => WriteAction::Added,
        Some(old) if old == entry => {
            return Ok((
                existing.unwrap_or_default().to_string(),
                WriteAction::Unchanged,
            ))
        }
        Some(_) => WriteAction::Updated,
    };
    servers.insert(name.to_string(), entry.clone());
    let text = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    Ok((format!("{text}\n"), action))
}

/// A file outside the project couldn't be written (exit 4, not 3: the
/// project is fine).
fn not_written(error: std::io::Error) -> CliError {
    CliError::new(ErrorKind::System, "io.failed", error.to_string())
}

/// Adds or updates `name` in the client's file. The file as it was before
/// Oleafly first changed it is kept as `<file>.oleafly-backup` (a later
/// write leaves that backup alone); an identical entry writes nothing.
pub fn write_entry(
    client: Client,
    path: &Path,
    name: &str,
    entry: &Value,
) -> Result<(WriteAction, Option<PathBuf>), CliError> {
    let existing =
        read_limited(path).map_err(|reason| unreadable(path, &reason, client, name, entry))?;
    let existing_text = existing
        .as_ref()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned());
    let (text, action) = updated_text(client, existing_text.as_deref(), name, entry)
        .map_err(|reason| unreadable(path, &reason, client, name, entry))?;
    if action == WriteAction::Unchanged {
        return Ok((action, None));
    }
    let backup = match &existing {
        Some(bytes) => {
            let mut name = path
                .file_name()
                .map(OsStr::to_os_string)
                .unwrap_or_default();
            name.push(BACKUP_SUFFIX);
            let backup = path.with_file_name(name);
            // The first backup is the user's own file; a second write must
            // not replace it with Oleafly's earlier edit.
            if std::fs::symlink_metadata(&backup).is_err() {
                // The client's config can hold its other servers' keys.
                oleafly_core::atomic::write_atomic_private(&backup, bytes).map_err(not_written)?;
            }
            Some(backup)
        }
        None => None,
    };
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(not_written)?;
    }
    oleafly_core::atomic::write_atomic(path, text.as_bytes()).map_err(not_written)?;
    Ok((action, backup))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(platform: Platform) -> ClientEnv {
        ClientEnv {
            platform,
            home: PathBuf::from("/home/ada"),
            app_data: Some(PathBuf::from(r"C:\Users\Ada Lovelace\AppData\Roaming")),
            xdg_config: Some(PathBuf::from("/home/ada/.xdg")),
            codex_home: None,
        }
    }

    #[test]
    fn client_paths_follow_each_os() {
        let root = Path::new("/p");
        assert_eq!(
            client_config_path(
                Client::ClaudeDesktop,
                Scope::User,
                &env(Platform::MacOs),
                root
            )
            .unwrap(),
            PathBuf::from(
                "/home/ada/Library/Application Support/Claude/claude_desktop_config.json"
            )
        );
        assert_eq!(
            client_config_path(
                Client::ClaudeDesktop,
                Scope::User,
                &env(Platform::Windows),
                root
            )
            .unwrap(),
            PathBuf::from(r"C:\Users\Ada Lovelace\AppData\Roaming")
                .join("Claude")
                .join("claude_desktop_config.json")
        );
        assert_eq!(
            client_config_path(
                Client::ClaudeDesktop,
                Scope::User,
                &env(Platform::Linux),
                root
            )
            .unwrap(),
            PathBuf::from("/home/ada/.xdg/Claude/claude_desktop_config.json")
        );
        let mut codex = env(Platform::Linux);
        assert_eq!(
            client_config_path(Client::Codex, Scope::User, &codex, root).unwrap(),
            PathBuf::from("/home/ada/.codex/config.toml")
        );
        codex.codex_home = Some(PathBuf::from("/opt/codex"));
        assert_eq!(
            client_config_path(Client::Codex, Scope::User, &codex, root).unwrap(),
            PathBuf::from("/opt/codex/config.toml")
        );
        assert_eq!(
            client_config_path(Client::Codex, Scope::Project, &codex, root).unwrap(),
            PathBuf::from("/p/.codex/config.toml")
        );
        assert_eq!(
            client_config_path(Client::Cursor, Scope::User, &codex, root).unwrap(),
            PathBuf::from("/home/ada/.cursor/mcp.json")
        );
        assert_eq!(
            client_config_path(Client::Gemini, Scope::Project, &codex, root).unwrap(),
            PathBuf::from("/p/.gemini/settings.json")
        );
        assert_eq!(
            client_config_path(Client::ClaudeCode, Scope::Project, &codex, root).unwrap(),
            PathBuf::from("/p/.mcp.json")
        );
        assert_eq!(
            client_config_path(Client::ClaudeCode, Scope::User, &codex, root),
            None
        );
    }

    #[test]
    fn entries_use_a_portable_command_in_projects_and_an_absolute_one_for_users() {
        let project = entry_for(Client::ClaudeCode, Scope::Project, "oleafly");
        assert_eq!(
            (
                project["command"].clone(),
                project["args"].clone(),
                project["type"].clone()
            ),
            (json!("oleafly"), json!(["mcp"]), json!("stdio"))
        );
        assert_eq!(
            entry_for(Client::ClaudeDesktop, Scope::User, "/x/oleafly")["args"],
            json!(["mcp", "--bridge", "always"])
        );
        assert_eq!(
            entry_for(Client::Gemini, Scope::Project, "oleafly")["timeout"],
            json!(300_000)
        );
        let codex = snippet(
            Client::Codex,
            "oleafly",
            &entry_for(Client::Codex, Scope::Project, "oleafly"),
        );
        assert!(codex.contains("tool_timeout_sec = 300"), "{codex}");
    }

    #[test]
    fn json_writes_keep_other_servers_and_back_up_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        let original = r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#;
        std::fs::write(&path, original).unwrap();
        let entry = entry_for(Client::Cursor, Scope::Project, "oleafly");
        let (action, backup) = write_entry(Client::Cursor, &path, "oleafly", &entry).unwrap();
        assert_eq!(action, WriteAction::Added);
        assert_eq!(std::fs::read_to_string(backup.unwrap()).unwrap(), original);
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["mcpServers"]["other"]["command"], "x");
        assert_eq!(written["theme"], "dark");
        assert_eq!(written["mcpServers"]["oleafly"], entry);
        let before = std::fs::read(&path).unwrap();
        let (again, _) = write_entry(Client::Cursor, &path, "oleafly", &entry).unwrap();
        assert_eq!(again, WriteAction::Unchanged);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn toml_writes_keep_comments_and_other_tables() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "# my setup\n[mcp_servers.other]\ncommand = \"x\"\n").unwrap();
        let entry = entry_for(Client::Codex, Scope::Project, "oleafly");
        write_entry(Client::Codex, &path, "oleafly", &entry).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("# my setup"));
        assert!(text.contains("[mcp_servers.other]"));
        assert!(text.contains("[mcp_servers.oleafly]"));
        assert!(text.contains("tool_timeout_sec = 300"));
    }

    #[test]
    fn the_codex_snippet_quotes_a_name_toml_needs_quoted() {
        let entry = entry_for(Client::Codex, Scope::Project, "oleafly");
        let text = snippet(Client::Codex, "oleafly thesis", &entry);
        let document = text.parse::<toml_edit::DocumentMut>().expect("valid TOML");
        assert_eq!(
            document["mcp_servers"]["oleafly thesis"]["tool_timeout_sec"].as_integer(),
            Some(300)
        );
        assert!(snippet(Client::Codex, "oleafly", &entry).starts_with("[mcp_servers.oleafly]"));
    }

    #[test]
    fn a_second_write_keeps_the_users_original_as_the_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        let original = r#"{"mcpServers":{"other":{"command":"x"}}}"#;
        std::fs::write(&path, original).unwrap();
        let first = entry_for(Client::Cursor, Scope::Project, "oleafly");
        let (_, backup) = write_entry(Client::Cursor, &path, "oleafly", &first).unwrap();
        let second = entry_for(Client::Cursor, Scope::Project, "/opt/oleafly");
        write_entry(Client::Cursor, &path, "oleafly", &second).unwrap();
        assert_eq!(std::fs::read_to_string(backup.unwrap()).unwrap(), original);
    }

    #[test]
    fn client_configs_never_contain_the_token() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("mcp.json"),
            r#"{"url":"http://127.0.0.1:1/mcp","token":"s3cr3t"}"#,
        )
        .unwrap();
        let path = dir.path().join(".cursor/mcp.json");
        let entry = entry_for(Client::Cursor, Scope::Project, "oleafly");
        write_entry(Client::Cursor, &path, "oleafly", &entry).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("s3cr3t"));
    }

    #[test]
    fn a_broken_json_config_is_left_alone_with_a_snippet() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{broken").unwrap();
        let entry = entry_for(Client::Gemini, Scope::Project, "oleafly");
        let error = write_entry(Client::Gemini, &path, "oleafly", &entry).unwrap_err();
        assert_eq!(error.code, "mcp.config_unreadable");
        assert!(error.message.contains("\"oleafly\""));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{broken");
    }

    #[test]
    fn configured_clients_find_project_entries() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(".mcp.json"),
            r#"{"mcpServers":{"oleafly":{"command":"oleafly"}}}"#,
        )
        .unwrap();
        let mut environment = env(Platform::Linux);
        environment.home = dir.path().join("home");
        let found = configured_clients(&environment, Some(dir.path()));
        assert_eq!(found.len(), 1);
        assert_eq!(
            (found[0].0, found[0].1),
            (Client::ClaudeCode, Scope::Project)
        );
    }
}
