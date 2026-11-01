//! Pure MCP JSON-RPC dispatch: no IO, no Tauri types, fully unit-testable.
//!
//! The server speaks stateless Streamable HTTP (spec 2025-06-18): every
//! request is a single JSON-RPC message answered with a single JSON body.
//! No sessions, no SSE, no batching (removed from the spec in 2025-06-18).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const PROTOCOL_VERSION: &str = "2025-06-18";
pub const SUPPORTED_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServerInfo<'a> {
    pub name: &'a str,
    pub title: &'a str,
    pub version: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolMeta {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    #[serde(
        rename = "outputSchema",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub output_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotations: Option<ToolAnnotations>,
}

impl ToolMeta {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
    ) -> Self {
        Self {
            name: name.into(),
            title: None,
            description: description.into(),
            input_schema,
            output_schema: None,
            annotations: None,
        }
    }
}

/// MCP tool annotations: hints for clients, not guarantees.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnnotations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destructive_hint: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotent_hint: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_world_hint: Option<bool>,
}

pub enum RpcOutcome {
    Reply(Value),
    Accepted,
    ForwardCall {
        id: Value,
        name: String,
        arguments: Value,
    },
}

pub fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

pub fn rpc_tool_error(id: Value, message: &str) -> Value {
    rpc_result(
        id,
        json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true,
        }),
    )
}

/// A tool result with structured content (and its JSON as text, for
/// clients that read only `content`).
pub fn tool_result(id: Value, structured: Value) -> Value {
    let text = serde_json::to_string(&structured).unwrap_or_default();
    rpc_result(
        id,
        json!({
            "content": [{ "type": "text", "text": text }],
            "structuredContent": structured,
        }),
    )
}

static SERVER_VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn set_server_version(version: &str) {
    let _ = SERVER_VERSION.set(version.to_string());
}

fn server_version() -> &'static str {
    SERVER_VERSION
        .get()
        .map_or(env!("CARGO_PKG_VERSION"), String::as_str)
}

pub fn dispatch(msg: &Value, tools: &[ToolMeta], instructions: &str) -> RpcOutcome {
    dispatch_with(
        msg,
        tools,
        instructions,
        &ServerInfo {
            name: "oleafly",
            title: "Oleafly",
            version: server_version(),
        },
    )
}

pub fn dispatch_with(
    msg: &Value,
    tools: &[ToolMeta],
    instructions: &str,
    server: &ServerInfo<'_>,
) -> RpcOutcome {
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let id = msg.get("id").cloned();
    match (method, id) {
        ("initialize", Some(id)) => {
            let requested = msg
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("");
            let version = if SUPPORTED_VERSIONS.contains(&requested) {
                requested
            } else {
                PROTOCOL_VERSION
            };
            RpcOutcome::Reply(rpc_result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": {
                        "name": server.name,
                        "title": server.title,
                        "version": server.version,
                    },
                    "instructions": instructions,
                }),
            ))
        }
        ("ping", Some(id)) => RpcOutcome::Reply(rpc_result(id, json!({}))),
        ("tools/list", Some(id)) => RpcOutcome::Reply(rpc_result(id, json!({ "tools": tools }))),
        ("tools/call", Some(id)) => {
            let name = msg
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if name.is_empty() || !tools.iter().any(|t| t.name == name) {
                return RpcOutcome::Reply(rpc_error(id, -32602, &format!("unknown tool: {name}")));
            }
            let arguments = msg
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            RpcOutcome::ForwardCall {
                id,
                name,
                arguments,
            }
        }
        // Notifications (no id) are accepted without a body, per spec.
        (_, None) => RpcOutcome::Accepted,
        (_, Some(id)) => RpcOutcome::Reply(rpc_error(id, -32601, "method not found")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tools() -> Vec<ToolMeta> {
        vec![ToolMeta::new(
            "read_file",
            "Read a file",
            json!({"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"], "additionalProperties": false}),
        )]
    }

    #[test]
    fn initialize_reports_the_given_server_version() {
        let msg = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}});
        let server = ServerInfo {
            name: "oleafly",
            title: "Oleafly",
            version: "9.9.9",
        };
        let RpcOutcome::Reply(v) = dispatch_with(&msg, &tools(), "", &server) else {
            panic!("expected reply")
        };
        assert_eq!(v.pointer("/result/serverInfo/version").unwrap(), "9.9.9");
        set_server_version("1.2.3");
        let RpcOutcome::Reply(v) = dispatch(&msg, &tools(), "") else {
            panic!("expected reply")
        };
        assert_eq!(v.pointer("/result/serverInfo/version").unwrap(), "1.2.3");
    }

    #[test]
    fn tool_metadata_round_trips_without_the_new_fields() {
        let webview = json!({"name": "x", "description": "d", "inputSchema": {"type": "object"}});
        let tool: ToolMeta = serde_json::from_value(webview.clone()).unwrap();
        assert_eq!(
            (
                tool.title.as_ref(),
                tool.output_schema.as_ref(),
                tool.annotations.as_ref()
            ),
            (None, None, None)
        );
        assert_eq!(serde_json::to_value(&tool).unwrap(), webview);
        let mut annotated = tool;
        annotated.annotations = Some(ToolAnnotations {
            read_only_hint: Some(true),
            ..ToolAnnotations::default()
        });
        assert_eq!(
            serde_json::to_value(&annotated).unwrap()["annotations"],
            json!({"readOnlyHint": true})
        );
    }

    #[test]
    fn structured_results_carry_text_too() {
        let response = tool_result(json!(1), json!({"success": true}));
        assert_eq!(response["result"]["structuredContent"]["success"], true);
        assert_eq!(
            response["result"]["content"][0]["text"],
            "{\"success\":true}"
        );
    }

    #[test]
    fn initialize_echoes_supported_version_and_advertises_tools() {
        let msg = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}});
        let RpcOutcome::Reply(v) = dispatch(&msg, &tools(), "hi") else {
            panic!("expected reply")
        };
        assert_eq!(v.pointer("/result/protocolVersion").unwrap(), "2025-03-26");
        assert_eq!(v.pointer("/result/serverInfo/name").unwrap(), "oleafly");
        assert!(v.pointer("/result/capabilities/tools").is_some());
        assert_eq!(v.pointer("/result/instructions").unwrap(), "hi");
    }

    #[test]
    fn tool_errors_are_successful_json_rpc_results() {
        let response = rpc_tool_error(json!(7), "approval is unavailable");
        assert_eq!(response["id"], 7);
        assert_eq!(response["result"]["isError"], true);
        assert_eq!(
            response["result"]["content"][0]["text"],
            "approval is unavailable"
        );
        assert!(response.get("error").is_none());
    }

    #[test]
    fn initialize_falls_back_to_our_version_for_unknown() {
        let msg = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "1999-01-01"}});
        let RpcOutcome::Reply(v) = dispatch(&msg, &tools(), "") else {
            panic!()
        };
        assert_eq!(
            v.pointer("/result/protocolVersion").unwrap(),
            PROTOCOL_VERSION
        );
    }

    #[test]
    fn initialized_notification_is_accepted() {
        let msg = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
        assert!(matches!(dispatch(&msg, &tools(), ""), RpcOutcome::Accepted));
    }

    #[test]
    fn ping_replies_empty_object() {
        let msg = json!({"jsonrpc": "2.0", "id": 7, "method": "ping"});
        let RpcOutcome::Reply(v) = dispatch(&msg, &tools(), "") else {
            panic!()
        };
        assert_eq!(v.pointer("/result").unwrap(), &json!({}));
        assert_eq!(v.pointer("/id").unwrap(), &json!(7));
    }

    #[test]
    fn tools_list_serializes_camel_case_schema() {
        let msg = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"});
        let RpcOutcome::Reply(v) = dispatch(&msg, &tools(), "") else {
            panic!()
        };
        let t = v.pointer("/result/tools/0").unwrap();
        assert_eq!(t["name"], "read_file");
        assert!(
            t.get("inputSchema").is_some(),
            "must be camelCase inputSchema"
        );
        assert!(t.get("input_schema").is_none());
    }

    #[test]
    fn tools_call_known_tool_forwards() {
        let msg = json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "read_file", "arguments": {"path": "main.tex"}}});
        let RpcOutcome::ForwardCall {
            id,
            name,
            arguments,
        } = dispatch(&msg, &tools(), "")
        else {
            panic!("expected forward")
        };
        assert_eq!(id, json!(3));
        assert_eq!(name, "read_file");
        assert_eq!(arguments["path"], "main.tex");
    }

    #[test]
    fn tools_call_unknown_tool_is_invalid_params() {
        let msg =
            json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "nope"}});
        let RpcOutcome::Reply(v) = dispatch(&msg, &tools(), "") else {
            panic!()
        };
        assert_eq!(v.pointer("/error/code").unwrap(), &json!(-32602));
    }

    #[test]
    fn unknown_method_is_method_not_found() {
        let msg = json!({"jsonrpc": "2.0", "id": 5, "method": "resources/list"});
        let RpcOutcome::Reply(v) = dispatch(&msg, &tools(), "") else {
            panic!()
        };
        assert_eq!(v.pointer("/error/code").unwrap(), &json!(-32601));
    }

    #[test]
    fn missing_arguments_defaults_to_empty_object() {
        let msg = json!({"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "read_file"}});
        let RpcOutcome::ForwardCall { arguments, .. } = dispatch(&msg, &tools(), "") else {
            panic!()
        };
        assert_eq!(arguments, json!({}));
    }
}
