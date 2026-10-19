//! `initialize`: what Oleafly offers and what the agent can do. Agents are
//! parsed leniently: an unknown or malformed field turns a feature off; it
//! never fails the connection.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::client::{ClientOptions, InitializeError, Negotiated, ProtocolVersion};

/// What an agent supports. The first seven fields keep the JSON names
/// Oleafly 0.4.7 stored, so saved session records still load.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentCapabilities {
    pub load_session: bool,
    pub resume: bool,
    pub image: bool,
    pub audio: bool,
    pub embedded_context: bool,
    pub additional_directories: bool,
    pub mcp_http: bool,
    pub list: bool,
    pub close: bool,
    pub delete: bool,
    pub fork: bool,
    pub mcp_sse: bool,
    pub logout: bool,
    pub providers: bool,
    pub steering: bool,
    pub auth_status: bool,
    /// The negotiated protocol version (0 for records saved before 0.4.8).
    pub protocol: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethod {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// The ACP auth method `type` (for example "terminal"), when reported.
    #[serde(default)]
    pub kind: Option<String>,
    /// Extra arguments for a terminal sign-in.
    #[serde(default)]
    pub args: Vec<String>,
    /// Extra environment for a terminal sign-in.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// The provider whose API key this method takes (`_meta["api-key"]`).
    #[serde(default)]
    pub api_key_provider: Option<String>,
    /// The agent's own sign-in command (`_meta["terminal-auth"]`).
    #[serde(default)]
    pub terminal_command: Option<TerminalAuthCommand>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAuthCommand {
    pub command: String,
    pub args: Vec<String>,
    pub label: Option<String>,
}

const MAX_AUTH_METHODS: usize = 12;
const MAX_AUTH_ARGS: usize = 32;
const MAX_AUTH_VALUE: usize = 4096;

/// The `initialize` params Oleafly sends for `version`.
pub fn initialize_params(options: &ClientOptions, version: ProtocolVersion) -> Value {
    match version {
        ProtocolVersion::V1 => json!({
            "protocolVersion": 1,
            "clientInfo": {
                "name": options.info.name,
                "title": options.info.title,
                "version": options.info.version,
            },
            "clientCapabilities": {
                "fs": {"readTextFile": options.fs_read, "writeTextFile": false},
                "terminal": false,
                "auth": {"terminal": true},
                "session": {
                    "configOptions": {"boolean": {}},
                    "notices": {},
                    "compaction": {},
                },
                "elicitation": {"form": {}, "url": {}},
                "_meta": {"terminal-auth": true},
            },
        }),
        ProtocolVersion::V2 => crate::v2::initialize_params_v2(options),
    }
}

/// Reads the agent's `initialize` answer. A v1 answer to a v2 request asks
/// for a fresh v1 connection.
pub fn parse_initialize(
    response: &Value,
    requested: ProtocolVersion,
) -> Result<Negotiated, InitializeError> {
    let version = response.get("protocolVersion").and_then(Value::as_u64);
    match (requested, version) {
        (ProtocolVersion::V1, Some(1)) => Ok(parse_v1(response)),
        (ProtocolVersion::V2, Some(2)) => crate::v2::parse_initialize_v2(response),
        (ProtocolVersion::V2, Some(1)) => Err(InitializeError::FallBackToV1),
        (ProtocolVersion::V1, _) => Err(InitializeError::NotAcp(
            "This agent does not support ACP version 1.".into(),
        )),
        (ProtocolVersion::V2, _) => Err(InitializeError::NotAcp(
            "This agent does not support ACP version 2.".into(),
        )),
    }
}

fn object(value: &Value) -> bool {
    value.is_object()
}

fn parse_v1(response: &Value) -> Negotiated {
    let caps = &response["agentCapabilities"];
    let session = &caps["sessionCapabilities"];
    let capabilities = AgentCapabilities {
        load_session: caps["loadSession"].as_bool() == Some(true),
        resume: object(&session["resume"]),
        image: caps["promptCapabilities"]["image"].as_bool() == Some(true),
        audio: caps["promptCapabilities"]["audio"].as_bool() == Some(true),
        embedded_context: caps["promptCapabilities"]["embeddedContext"].as_bool() == Some(true),
        additional_directories: object(&session["additionalDirectories"]),
        mcp_http: caps["mcpCapabilities"]["http"].as_bool() == Some(true),
        list: object(&session["list"]),
        close: object(&session["close"]),
        delete: object(&session["delete"]),
        fork: object(&session["fork"]),
        mcp_sse: caps["mcpCapabilities"]["sse"].as_bool() == Some(true),
        logout: object(&caps["auth"]["logout"]),
        providers: object(&caps["providers"]),
        steering: response["_meta"]["steering"]["supported"].as_bool() == Some(true)
            || caps["_meta"]["steering"]["supported"].as_bool() == Some(true),
        auth_status: object(&caps["_meta"]["authStatus"]),
        protocol: 1,
    };
    Negotiated {
        protocol: ProtocolVersion::V1,
        capabilities,
        auth_methods: auth_methods(&response["authMethods"], "id", EnvShape::Map),
        agent_name: text(&response["agentInfo"]["name"]),
        agent_title: text(&response["agentInfo"]["title"]),
        agent_version: text(&response["agentInfo"]["version"]),
        raw: response.clone(),
    }
}

pub(crate) fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 512)
        .map(str::to_owned)
}

/// How an auth method lists its environment.
#[derive(Clone, Copy)]
pub(crate) enum EnvShape {
    /// v1: `{"NAME": "value"}`.
    Map,
    /// v2: `[{"name": "NAME", "value": "value"}]`.
    Pairs,
}

fn plain_text(value: &str) -> bool {
    value.len() <= MAX_AUTH_VALUE && !value.contains(['\0', '\r', '\n'])
}

fn env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Auth methods, at most 12. An entry with an invalid argument, variable or
/// command is dropped.
pub(crate) fn auth_methods(value: &Value, id_key: &str, env: EnvShape) -> Vec<AuthMethod> {
    value
        .as_array()
        .map(|methods| {
            methods
                .iter()
                .filter_map(|method| auth_method(method, id_key, env))
                .take(MAX_AUTH_METHODS)
                .collect()
        })
        .unwrap_or_default()
}

fn auth_method(value: &Value, id_key: &str, env_shape: EnvShape) -> Option<AuthMethod> {
    let id = text(&value[id_key])?;
    let name = text(&value["name"]).unwrap_or_else(|| id.clone());
    let kind = value["type"]
        .as_str()
        .filter(|kind| kind.len() <= 64)
        .map(str::to_owned);
    let mut args = Vec::new();
    if let Some(values) = value["args"].as_array() {
        if values.len() > MAX_AUTH_ARGS {
            return None;
        }
        for arg in values {
            let arg = arg.as_str()?;
            if !plain_text(arg) {
                return None;
            }
            args.push(arg.to_owned());
        }
    }
    let mut env = BTreeMap::new();
    match env_shape {
        EnvShape::Map => {
            if let Some(entries) = value["env"].as_object() {
                if entries.len() > MAX_AUTH_ARGS {
                    return None;
                }
                for (name, value) in entries {
                    let value = value.as_str()?;
                    if !env_name(name) || !plain_text(value) {
                        return None;
                    }
                    env.insert(name.clone(), value.to_owned());
                }
            }
        }
        EnvShape::Pairs => {
            if let Some(entries) = value["env"].as_array() {
                if entries.len() > MAX_AUTH_ARGS {
                    return None;
                }
                for entry in entries {
                    let name = entry["name"].as_str()?;
                    let value = entry["value"].as_str()?;
                    if !env_name(name) || !plain_text(value) {
                        return None;
                    }
                    env.insert(name.to_owned(), value.to_owned());
                }
            }
        }
    }
    let api_key_provider = text(&value["_meta"]["api-key"]["provider"]);
    let terminal_command = match &value["_meta"]["terminal-auth"] {
        Value::Object(command) => {
            let program = command.get("command").and_then(Value::as_str)?;
            if !std::path::Path::new(program).is_absolute() || !plain_text(program) {
                return None;
            }
            let mut args = Vec::new();
            if let Some(values) = command.get("args").and_then(Value::as_array) {
                if values.len() > MAX_AUTH_ARGS {
                    return None;
                }
                for arg in values {
                    let arg = arg.as_str()?;
                    if !plain_text(arg) {
                        return None;
                    }
                    args.push(arg.to_owned());
                }
            }
            Some(TerminalAuthCommand {
                command: program.to_owned(),
                args,
                label: command.get("label").and_then(text),
            })
        }
        _ => None,
    };
    Some(AuthMethod {
        id,
        name,
        description: text(&value["description"]),
        kind,
        args,
        env,
        api_key_provider,
        terminal_command,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ClientInfo;

    fn options(fs_read: bool, prefer_v2: bool) -> ClientOptions {
        ClientOptions {
            info: ClientInfo {
                name: "oleafly".into(),
                title: "Oleafly".into(),
                version: "0.4.8".into(),
            },
            prefer_v2,
            fs_read,
        }
    }

    #[test]
    fn v1_initialize_params_advertise_the_v1_26_client_capabilities() {
        let params = initialize_params(&options(true, false), ProtocolVersion::V1);
        assert_eq!(
            params,
            json!({"protocolVersion":1,"clientInfo":{"name":"oleafly","title":"Oleafly","version":"0.4.8"},
                "clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":false},"terminal":false,
                "auth":{"terminal":true},
                "session":{"configOptions":{"boolean":{}},"notices":{},"compaction":{}},
                "elicitation":{"form":{},"url":{}},
                "_meta":{"terminal-auth":true}}})
        );
        let typed: Result<agent_client_protocol_schema::v1::InitializeRequest, _> =
            serde_json::from_value(params);
        assert!(typed.is_ok(), "{typed:?}");
        let without_fs = initialize_params(&options(false, false), ProtocolVersion::V1);
        assert_eq!(
            without_fs["clientCapabilities"]["fs"]["readTextFile"],
            false
        );
    }

    #[test]
    fn capabilities_parse_session_list_fork_close_delete_logout_providers_and_steering() {
        let negotiated = parse_initialize(
            &json!({
                "protocolVersion": 1,
                "agentInfo": {"name": "claude-acp", "title": "Claude", "version": "0.93.0"},
                "agentCapabilities": {
                    "loadSession": true,
                    "promptCapabilities": {"image": true, "embeddedContext": true},
                    "mcpCapabilities": {"http": true, "sse": false},
                    "sessionCapabilities": {"list": {}, "resume": {}, "close": {}, "delete": {}, "fork": {}},
                    "auth": {"logout": {}},
                    "providers": {},
                    "_meta": {"authStatus": {}},
                },
                "_meta": {"steering": {"supported": true}},
            }),
            ProtocolVersion::V1,
        )
        .unwrap();
        let caps = negotiated.capabilities;
        assert!(
            caps.load_session && caps.resume && caps.list && caps.close && caps.delete && caps.fork
        );
        assert!(caps.image && caps.embedded_context && !caps.audio);
        assert!(caps.mcp_http && !caps.mcp_sse);
        assert!(caps.logout && caps.providers && caps.steering && caps.auth_status);
        assert_eq!(caps.protocol, 1);
        assert_eq!(negotiated.agent_version.as_deref(), Some("0.93.0"));
    }

    #[test]
    fn unknown_capabilities_are_disabled_and_versions_are_checked() {
        let negotiated = parse_initialize(
            &json!({"protocolVersion": 1, "agentCapabilities": {"loadSession": "yes", "promptCapabilities": 3}}),
            ProtocolVersion::V1,
        )
        .unwrap();
        assert_eq!(
            negotiated.capabilities,
            AgentCapabilities {
                protocol: 1,
                ..Default::default()
            }
        );
        assert!(matches!(
            parse_initialize(&json!({"protocolVersion": 2}), ProtocolVersion::V1),
            Err(InitializeError::NotAcp(message)) if message == "This agent does not support ACP version 1."
        ));
        assert!(matches!(
            parse_initialize(&json!({}), ProtocolVersion::V1),
            Err(InitializeError::NotAcp(_))
        ));
        assert!(matches!(
            parse_initialize(&json!({"protocolVersion": 1}), ProtocolVersion::V2),
            Err(InitializeError::FallBackToV1)
        ));
    }

    #[test]
    fn terminal_auth_methods_keep_args_env_and_the_meta_command() {
        let program = if cfg!(windows) {
            r"C:\Program Files\Claude\claude.exe"
        } else {
            "/usr/local/bin/claude"
        };
        let methods = auth_methods(
            &json!([
                {"id": "claude-ai-login", "name": "Log in with Claude", "type": "terminal",
                 "args": ["--login"], "env": {"CLAUDE_CODE_ENTRYPOINT": "acp"},
                 "_meta": {"terminal-auth": {"command": program, "args": ["/login"], "label": "Claude login"}}},
                {"id": "console-login", "name": "Anthropic Console", "type": "terminal"},
            ]),
            "id",
            EnvShape::Map,
        );
        assert_eq!(methods.len(), 2);
        assert_eq!(methods[0].args, vec!["--login".to_string()]);
        assert_eq!(methods[0].env["CLAUDE_CODE_ENTRYPOINT"], "acp");
        let command = methods[0].terminal_command.as_ref().unwrap();
        assert_eq!(command.command, program);
        assert_eq!(command.args, vec!["/login".to_string()]);
        assert_eq!(command.label.as_deref(), Some("Claude login"));
        assert_eq!(methods[1].kind.as_deref(), Some("terminal"));
    }

    #[test]
    fn auth_methods_with_bad_env_names_or_newlines_are_dropped() {
        let methods = auth_methods(
            &json!([
                {"id": "bad-env", "name": "x", "env": {"1BAD": "v"}},
                {"id": "bad-arg", "name": "x", "args": ["line\nbreak"]},
                {"id": "relative", "name": "x", "_meta": {"terminal-auth": {"command": "claude"}}},
                {"id": "good", "name": "Good"},
            ]),
            "id",
            EnvShape::Map,
        );
        assert_eq!(
            methods
                .iter()
                .map(|method| method.id.as_str())
                .collect::<Vec<_>>(),
            vec!["good"]
        );
    }

    #[test]
    fn api_key_methods_report_their_provider() {
        let methods = auth_methods(
            &json!([{"id": "api-key", "name": "API key", "_meta": {"api-key": {"provider": "openai"}}}]),
            "id",
            EnvShape::Map,
        );
        assert_eq!(methods[0].api_key_provider.as_deref(), Some("openai"));
    }

    #[test]
    fn old_records_deserialize_without_new_capability_fields() {
        let caps: AgentCapabilities = serde_json::from_value(json!({"loadSession":true,"resume":false,"image":true,"audio":false,"embeddedContext":false,"additionalDirectories":false,"mcpHttp":true})).unwrap();
        assert!(caps.load_session && caps.mcp_http);
        assert!(!caps.fork && caps.protocol == 0);
        let method: AuthMethod =
            serde_json::from_value(json!({"id": "a", "name": "A", "description": null})).unwrap();
        assert!(method.args.is_empty() && method.terminal_command.is_none());
    }
}
