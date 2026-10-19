//! ACP protocol v2 (draft), used when the "Use ACP v2 when available"
//! Experimental switch is on. Everything v2 sends is translated to the v1
//! shapes the rest of Oleafly understands.
use std::collections::{HashMap, HashSet, VecDeque};

use serde_json::{json, Value};

use crate::capabilities::{auth_methods, text, AgentCapabilities, EnvShape};
use crate::client::{ClientOptions, InitializeError, Negotiated, ProtocolVersion};

/// The draft this client implements.
pub const DRAFT_VERSION: &str = "2.0.0-alpha.9";

pub fn initialize_params_v2(options: &ClientOptions) -> Value {
    json!({
        "protocolVersion": 2,
        "info": {
            "name": options.info.name,
            "title": options.info.title,
            "version": options.info.version,
        },
        "capabilities": {
            "auth": {"terminal": {}},
            "elicitation": {"form": {}, "url": {}},
            "_meta": {"terminal-auth": true},
        },
    })
}

/// Reads a v2 `initialize` answer. Session listing, resume and close are
/// part of the v2 baseline; `session/load` does not exist in v2.
pub fn parse_initialize_v2(response: &Value) -> Result<Negotiated, InitializeError> {
    if response.get("protocolVersion").and_then(Value::as_u64) != Some(2) {
        return Err(InitializeError::NotAcp(
            "This agent does not support ACP version 2.".into(),
        ));
    }
    let caps = &response["capabilities"];
    let session = &caps["session"];
    let prompt = &session["prompt"];
    let mcp = &session["mcp"];
    let capabilities = AgentCapabilities {
        load_session: false,
        resume: true,
        image: prompt["image"].is_object(),
        audio: prompt["audio"].is_object(),
        embedded_context: prompt["embeddedContext"].is_object(),
        additional_directories: session["additionalDirectories"].is_object(),
        mcp_http: mcp["http"].is_object(),
        list: true,
        close: true,
        delete: session["delete"].is_object(),
        fork: session["fork"].is_object(),
        mcp_sse: false,
        logout: caps["auth"]["logout"].is_object(),
        providers: caps["providers"].is_object(),
        steering: response["_meta"]["steering"]["supported"].as_bool() == Some(true),
        auth_status: caps["_meta"]["authStatus"].is_object(),
        protocol: 2,
    };
    Ok(Negotiated {
        protocol: ProtocolVersion::V2,
        capabilities,
        auth_methods: auth_methods(&response["authMethods"], "methodId", EnvShape::Pairs),
        agent_name: text(&response["info"]["name"]),
        agent_title: text(&response["info"]["title"]),
        agent_version: text(&response["info"]["version"]),
        raw: response.clone(),
    })
}

/// Text kept per streamed message to turn v2 upserts into v1 deltas.
const MAX_MESSAGE_TEXT: usize = 256 * 1024;
const MAX_MESSAGES: usize = 64;
const MAX_TOOL_IDS: usize = 4096;

/// What one v2 `session/update` becomes.
#[derive(Clone, Debug, PartialEq)]
pub enum Translated {
    /// v1-shaped `session/update` params.
    Update(Value),
    /// The session went idle: the running prompt ends with `outcome`
    /// (`{stopReason, usage?, _meta?}`).
    TurnEnd { session_id: String, outcome: Value },
}

#[derive(Default)]
struct MessageText {
    length: usize,
    prefix: String,
}

/// Turns v2 session updates into v1 ones.
#[derive(Default)]
pub struct V2Translator {
    messages: HashMap<(String, String, String), MessageText>,
    order: VecDeque<(String, String, String)>,
    tools: HashSet<(String, String)>,
}

fn joined_text(content: &Value) -> String {
    match content {
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
        Value::Object(_) => content["text"].as_str().unwrap_or("").to_owned(),
        _ => String::new(),
    }
}

fn prefix_of(text: &str) -> String {
    let mut end = text.len().min(MAX_MESSAGE_TEXT);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

impl V2Translator {
    fn wrap(session: &str, update: Value) -> Translated {
        Translated::Update(json!({"sessionId": session, "update": update}))
    }

    fn remember_message(&mut self, key: (String, String, String), text: &str) {
        if !self.messages.contains_key(&key) {
            self.order.push_back(key.clone());
            while self.order.len() > MAX_MESSAGES {
                if let Some(old) = self.order.pop_front() {
                    self.messages.remove(&old);
                }
            }
        }
        self.messages.insert(
            key,
            MessageText {
                length: text.len(),
                prefix: prefix_of(text),
            },
        );
    }

    /// Marks a tool id as seen; true the first time.
    fn first_sight(&mut self, session: &str, id: &str) -> bool {
        if self.tools.len() >= MAX_TOOL_IDS {
            self.tools.clear();
        }
        self.tools.insert((session.to_owned(), id.to_owned()))
    }

    fn upsert_message(&mut self, session: &str, kind: &str, update: &Value) -> Vec<Translated> {
        let chunk = if kind == "agent_message" {
            "agent_message_chunk"
        } else {
            "agent_thought_chunk"
        };
        let id = update["messageId"].as_str().unwrap_or("").to_owned();
        let text = joined_text(&update["content"]);
        let key = (session.to_owned(), chunk.to_owned(), id.clone());
        let previous = self.messages.get(&key);
        let extends = previous.is_some_and(|previous| {
            text.len() >= previous.length && text.starts_with(&previous.prefix)
        });
        let start = previous.map_or(0, |previous| previous.length);
        let translated = if previous.is_none() || extends {
            let delta = text.get(start..).unwrap_or("");
            if delta.is_empty() {
                Vec::new()
            } else {
                vec![Self::wrap(
                    session,
                    json!({"sessionUpdate": chunk, "content": {"type": "text", "text": delta}, "messageId": id}),
                )]
            }
        } else {
            vec![Self::wrap(
                session,
                json!({"sessionUpdate": chunk, "content": {"type": "text", "text": text}, "messageId": id, "replace": true}),
            )]
        };
        self.remember_message(key, &text);
        translated
    }

    fn tool_update(&mut self, session: &str, id: &str, mut update: Value) -> Translated {
        let kind = if self.first_sight(session, id) {
            "tool_call"
        } else {
            "tool_call_update"
        };
        update["sessionUpdate"] = json!(kind);
        update["toolCallId"] = json!(id);
        Self::wrap(session, update)
    }

    fn plan(update: &Value) -> Value {
        let plan = &update["plan"];
        let entries = match plan["type"].as_str() {
            Some("items") => plan["entries"].clone(),
            Some("markdown") => {
                json!([{"content": plan["content"], "priority": "medium", "status": "pending"}])
            }
            Some("file") => {
                json!([{"content": plan["path"].as_str().or(plan["uri"].as_str()).unwrap_or("Plan file"), "priority": "medium", "status": "pending"}])
            }
            _ => json!([]),
        };
        json!({"sessionUpdate": "plan", "entries": entries})
    }

    pub fn translate(&mut self, params: &Value) -> Vec<Translated> {
        let Some(session) = params["sessionId"].as_str() else {
            return Vec::new();
        };
        let update = &params["update"];
        let Some(kind) = update["sessionUpdate"].as_str() else {
            return Vec::new();
        };
        match kind {
            "agent_message_chunk" | "agent_thought_chunk" => {
                vec![Translated::Update(params.clone())]
            }
            "agent_message" | "agent_thought" => self.upsert_message(session, kind, update),
            "tool_call_update" => match update["toolCallId"].as_str() {
                Some(id) => {
                    let id = id.to_owned();
                    let mut update = update.clone();
                    if update["title"].is_null() && update["name"].is_string() {
                        update["title"] = update["name"].clone();
                    }
                    vec![self.tool_update(session, &id, update)]
                }
                None => Vec::new(),
            },
            "tool_call_content_chunk" => match update["toolCallId"].as_str() {
                Some(id) => {
                    let id = id.to_owned();
                    vec![self.tool_update(
                        session,
                        &id,
                        json!({"content": [update["content"]], "append": true}),
                    )]
                }
                None => Vec::new(),
            },
            "terminal_update" | "terminal_output_chunk" => {
                let Some(terminal) = update["terminalId"].as_str() else {
                    return Vec::new();
                };
                let text = if kind == "terminal_output_chunk" {
                    update["data"].as_str().unwrap_or("").to_owned()
                } else {
                    update["output"]["data"]
                        .as_str()
                        .or(update["command"].as_str())
                        .unwrap_or("")
                        .to_owned()
                };
                let id = format!("terminal:{terminal}");
                vec![self.tool_update(
                    session,
                    &id,
                    json!({"title": "Terminal", "kind": "execute",
                        "content": [{"type": "content", "content": {"type": "text", "text": text}}],
                        "append": true}),
                )]
            }
            "plan_update" => vec![Self::wrap(session, Self::plan(update))],
            "state_update" => match update["state"].as_str() {
                Some("idle") => {
                    let mut outcome = json!({
                        "stopReason": update["stopReason"].as_str().unwrap_or("end_turn"),
                    });
                    if update["usage"].is_object() {
                        outcome["usage"] = update["usage"].clone();
                    }
                    if update["_meta"].is_object() {
                        outcome["_meta"] = update["_meta"].clone();
                    }
                    vec![Translated::TurnEnd {
                        session_id: session.to_owned(),
                        outcome,
                    }]
                }
                _ => Vec::new(),
            },
            "config_option_update"
            | "config_options_update"
            | "session_info_update"
            | "usage_update"
            | "notice"
            | "compaction_update"
            | "compaction_summary_chunk"
            | "available_commands_update"
            | "current_mode_update" => vec![Translated::Update(params.clone())],
            _ => Vec::new(),
        }
    }
}

/// A v2 permission request in the v1 shape (`toolCall` + `options`). A
/// subject Oleafly does not know returns `None` and is answered cancelled.
pub fn permission_params_to_v1(params: &Value) -> Option<Value> {
    let subject = &params["subject"];
    let tool_call = match subject["type"].as_str() {
        None if subject.is_null() => json!({"title": params["title"]}),
        Some("tool_call") => {
            let mut call = subject["toolCall"].clone();
            if !call.is_object() {
                return None;
            }
            if call["title"].is_null() {
                call["title"] = params["title"].clone();
            }
            call
        }
        Some("command") => {
            let command = subject["command"].as_str()?;
            json!({
                "toolCallId": subject["toolCallId"].as_str().unwrap_or("command"),
                "title": command,
                "kind": "execute",
                "rawInput": {"command": command, "cwd": subject["cwd"]},
            })
        }
        _ => return None,
    };
    Some(json!({
        "sessionId": params["sessionId"],
        "toolCall": tool_call,
        "options": params["options"],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ClientInfo;

    fn options() -> ClientOptions {
        ClientOptions {
            info: ClientInfo {
                name: "oleafly".into(),
                title: "Oleafly".into(),
                version: "0.4.8".into(),
            },
            prefer_v2: true,
            fs_read: false,
        }
    }

    #[test]
    fn v2_capabilities_map_to_the_same_flags() {
        let negotiated = parse_initialize_v2(&json!({
            "protocolVersion": 2,
            "info": {"name": "claude-acp", "version": "0.93.0"},
            "capabilities": {
                "session": {
                    "prompt": {"image": {}, "embeddedContext": {}},
                    "mcp": {"http": {}, "stdio": {}},
                    "delete": {},
                    "fork": {},
                },
                "auth": {"logout": {}},
            },
        }))
        .unwrap();
        let caps = negotiated.capabilities;
        assert!(caps.resume && caps.list && caps.close && !caps.load_session);
        assert!(caps.image && caps.embedded_context && caps.mcp_http);
        assert!(caps.delete && caps.fork && caps.logout);
        assert_eq!(caps.protocol, 2);
    }

    #[test]
    fn v2_auth_methods_use_method_id_and_env_pairs() {
        let negotiated = parse_initialize_v2(&json!({
            "protocolVersion": 2,
            "info": {"name": "agent"},
            "capabilities": {},
            "authMethods": [{"type": "terminal", "methodId": "login", "name": "Log in",
                "args": ["--login"], "env": [{"name": "MODE", "value": "acp"}]}],
        }))
        .unwrap();
        let method = &negotiated.auth_methods[0];
        assert_eq!(method.id, "login");
        assert_eq!(method.env["MODE"], "acp");
    }

    #[test]
    fn v2_initialize_params_match_the_draft_schema() {
        let params = initialize_params_v2(&options());
        let typed: Result<agent_client_protocol_schema::v2::InitializeRequest, _> =
            serde_json::from_value(params);
        assert!(typed.is_ok(), "{typed:?}");
    }

    fn upsert(kind: &str, id: &str, text: &str) -> Value {
        json!({"sessionId": "s", "update": {"sessionUpdate": kind, "messageId": id,
            "content": [{"type": "text", "text": text}]}})
    }

    #[test]
    fn agent_message_upserts_become_chunk_deltas() {
        let mut translator = V2Translator::default();
        let first = translator.translate(&upsert("agent_message", "m1", "Hel"));
        let second = translator.translate(&upsert("agent_message", "m1", "Hello"));
        let Translated::Update(first) = &first[0] else {
            panic!()
        };
        let Translated::Update(second) = &second[0] else {
            panic!()
        };
        assert_eq!(first["update"]["sessionUpdate"], "agent_message_chunk");
        assert_eq!(first["update"]["content"]["text"], "Hel");
        assert_eq!(second["update"]["content"]["text"], "lo");
        assert!(translator
            .translate(&upsert("agent_message", "m1", "Hello"))
            .is_empty());
    }

    #[test]
    fn a_non_prefix_upsert_replaces_the_message() {
        let mut translator = V2Translator::default();
        translator.translate(&upsert("agent_thought", "t1", "Draft one"));
        let replaced = translator.translate(&upsert("agent_thought", "t1", "Another"));
        let Translated::Update(update) = &replaced[0] else {
            panic!()
        };
        assert_eq!(update["update"]["sessionUpdate"], "agent_thought_chunk");
        assert_eq!(update["update"]["replace"], true);
        assert_eq!(update["update"]["content"]["text"], "Another");
    }

    #[test]
    fn tool_call_content_chunks_append() {
        let mut translator = V2Translator::default();
        let first = translator.translate(
            &json!({"sessionId": "s", "update": {"sessionUpdate": "tool_call_update",
            "toolCallId": "t", "name": "Read", "status": "in_progress"}}),
        );
        let chunk = translator.translate(&json!({"sessionId": "s", "update": {"sessionUpdate": "tool_call_content_chunk",
            "toolCallId": "t", "content": {"type": "content", "content": {"type": "text", "text": "abc"}}}}));
        let Translated::Update(first) = &first[0] else {
            panic!()
        };
        let Translated::Update(chunk) = &chunk[0] else {
            panic!()
        };
        assert_eq!(first["update"]["sessionUpdate"], "tool_call");
        assert_eq!(first["update"]["title"], "Read");
        assert_eq!(chunk["update"]["sessionUpdate"], "tool_call_update");
        assert_eq!(chunk["update"]["append"], true);
        assert_eq!(chunk["update"]["content"][0]["content"]["text"], "abc");
    }

    #[test]
    fn idle_state_ends_the_turn_and_running_is_dropped() {
        let mut translator = V2Translator::default();
        assert!(translator
            .translate(&json!({"sessionId": "s", "update": {"sessionUpdate": "state_update", "state": "running"}}))
            .is_empty());
        let ended = translator.translate(
            &json!({"sessionId": "s", "update": {"sessionUpdate": "state_update",
            "state": "idle", "stopReason": "end_turn", "usage": {"inputTokens": 3}}}),
        );
        assert_eq!(
            ended,
            vec![Translated::TurnEnd {
                session_id: "s".into(),
                outcome: json!({"stopReason": "end_turn", "usage": {"inputTokens": 3}}),
            }]
        );
        assert!(translator
            .translate(&json!({"sessionId": "s", "update": {"sessionUpdate": "user_message", "messageId": "u"}}))
            .is_empty());
    }

    #[test]
    fn unknown_v2_permission_subjects_are_cancelled() {
        assert!(
            permission_params_to_v1(&json!({"sessionId": "s", "title": "x",
            "subject": {"type": "_teleport"}, "options": []}))
            .is_none()
        );
        let command = permission_params_to_v1(&json!({"sessionId": "s", "title": "Run",
            "subject": {"type": "command", "command": "latexmk", "cwd": "/p"}, "options": []}))
        .unwrap();
        assert_eq!(command["toolCall"]["kind"], "execute");
        assert_eq!(command["toolCall"]["rawInput"]["cwd"], "/p");
    }

    #[test]
    fn v2_initialize_params_name_protocol_two() {
        let params = initialize_params_v2(&options());
        assert_eq!(params["protocolVersion"], 2);
        assert_eq!(params["info"]["name"], "oleafly");
    }
}
