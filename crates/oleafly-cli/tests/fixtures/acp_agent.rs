// A CLI agent for tests that speaks ACP version 1 over stdio, built with
// plain rustc (std only). Switches (environment):
// FIXTURE_CAPS   comma list of resume, load, close: what initialize offers
// FIXTURE_LOG    append "method <name>", "prompt <text>" and "permission
//                <answer>" lines to this file
// FIXTURE_ASK    on a prompt, ask permission to run a command first
// FIXTURE_ASK_TOOL  on a prompt, ask permission with this JSON as toolCall
// FIXTURE_ANNOUNCE  before asking, send a tool_call update with these JSON
//                   fields (`"toolCallId":...,"kind":...` without braces)
// FIXTURE_MODE   start sessions in this legacy mode (`default` and
//                `bypassPermissions` are offered); log "set_mode <id>"
// FIXTURE_NO_INIT  never answer initialize
// FIXTURE_SLOW   on a prompt, wait for session/cancel and end "cancelled"
// It keeps a file per session under $HOME/.claude/projects, as an agent
// keeps its own history.
use std::io::{BufRead, Write};

const PERMISSION_ID: u64 = 900;

/// The JSON text of the value after `key`: a number or a quoted string.
fn raw_after(line: &str, key: &str) -> Option<String> {
    let start = line.find(key)? + key.len();
    let rest = line[start..].trim_start();
    if rest.starts_with('"') {
        let end = rest[1..].find('"')? + 2;
        return Some(rest[..end].to_string());
    }
    let digits: String = rest
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '-')
        .collect();
    (!digits.is_empty()).then_some(digits)
}

fn string_after(line: &str, key: &str) -> Option<String> {
    let start = line.find(key)? + key.len();
    let rest = line[start..].trim_start().strip_prefix('"')?;
    let mut value = String::new();
    let mut escaped = false;
    for character in rest.chars() {
        if escaped {
            value.push(match character {
                'n' => '\n',
                't' => '\t',
                other => other,
            });
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            return Some(value);
        } else {
            value.push(character);
        }
    }
    None
}

fn log(line: &str) {
    if let Ok(path) = std::env::var("FIXTURE_LOG") {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(file, "{line}");
        }
    }
}

fn send(stdout: &mut std::io::Stdout, message: &str) {
    let _ = writeln!(stdout, "{message}");
    let _ = stdout.flush();
}

fn keep_session(session: &str) {
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        let folder = std::path::Path::new(&home).join(".claude").join("projects");
        let _ = std::fs::create_dir_all(&folder);
        let _ = std::fs::write(folder.join(format!("{session}.json")), "{}");
    }
}

fn update(stdout: &mut std::io::Stdout, session: &str, text: &str) {
    send(
        stdout,
        &format!(
            "{{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{{\"sessionId\":\"{session}\",\"update\":{{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{{\"type\":\"text\",\"text\":\"{text}\"}}}}}}}}"
        ),
    );
}

/// The agent: the switches the test set in the environment, and what it
/// keeps between messages.
struct Agent {
    caps: String,
    ask: bool,
    ask_tool: String,
    announce: Option<String>,
    modes: String,
    no_init: bool,
    slow: bool,
    stdout: std::io::Stdout,
    session: String,
    pending_prompt: Option<String>,
}

impl Agent {
    fn from_env() -> Self {
        let ask_tool = std::env::var("FIXTURE_ASK_TOOL").ok();
        let ask = std::env::var("FIXTURE_ASK").is_ok() || ask_tool.is_some();
        let ask_tool = ask_tool.unwrap_or_else(|| {
            "{\"toolCallId\":\"tool-1\",\"title\":\"Run tests\",\"kind\":\"execute\",\"rawInput\":{\"command\":\"make test\"}}".to_string()
        });
        let modes = std::env::var("FIXTURE_MODE").ok().map(|mode| {
            format!(",\"modes\":{{\"currentModeId\":\"{mode}\",\"availableModes\":[{{\"id\":\"default\",\"name\":\"Default\"}},{{\"id\":\"bypassPermissions\",\"name\":\"Bypass permissions\"}}]}}")
        }).unwrap_or_default();
        Self {
            caps: std::env::var("FIXTURE_CAPS").unwrap_or_default(),
            ask,
            ask_tool,
            announce: std::env::var("FIXTURE_ANNOUNCE").ok(),
            modes,
            no_init: std::env::var("FIXTURE_NO_INIT").is_ok(),
            slow: std::env::var("FIXTURE_SLOW").is_ok(),
            stdout: std::io::stdout(),
            session: String::from("agent-session-1"),
            pending_prompt: None,
        }
    }

    fn has(&self, name: &str) -> bool {
        self.caps.split(',').any(|cap| cap.trim() == name)
    }

    fn handle_line(&mut self, line: &str) {
        let method = string_after(line, "\"method\":");
        let id = raw_after(line, "\"id\":");
        let Some(method) = method else {
            self.answer_permission(line, id.as_deref());
            return;
        };
        if method == "session/cancel" {
            self.cancel();
            return;
        }
        let Some(id) = id else {
            return;
        };
        log(&format!("method {method}"));
        if self.no_init && method == "initialize" {
            return;
        }
        let Some(result) = self.result_for(line, &method, &id) else {
            return;
        };
        send(
            &mut self.stdout,
            &format!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{result}}}"),
        );
    }

    /// An answer to the permission request ends the prompt that waits for it.
    fn answer_permission(&mut self, line: &str, id: Option<&str>) {
        if id != Some(PERMISSION_ID.to_string().as_str()) {
            return;
        }
        log(&format!("permission {line}"));
        if let Some(prompt) = self.pending_prompt.take() {
            update(&mut self.stdout, &self.session, "done");
            send(&mut self.stdout, &format!("{{\"jsonrpc\":\"2.0\",\"id\":{prompt},\"result\":{{\"stopReason\":\"end_turn\"}}}}"));
        }
    }

    fn cancel(&mut self) {
        log("method session/cancel");
        if let Some(prompt) = self.pending_prompt.take() {
            send(&mut self.stdout, &format!("{{\"jsonrpc\":\"2.0\",\"id\":{prompt},\"result\":{{\"stopReason\":\"cancelled\"}}}}"));
        }
    }

    /// The `result` to answer request `id` with, or `None` when the reply
    /// was already sent or comes later.
    fn result_for(&mut self, line: &str, method: &str, id: &str) -> Option<String> {
        match method {
            "initialize" => Some(self.initialize_result()),
            "session/new" => {
                keep_session(&self.session);
                Some(format!(
                    "{{\"sessionId\":\"{session}\"{modes}}}",
                    session = self.session,
                    modes = self.modes
                ))
            }
            "session/resume" | "session/load" => Some(self.reopen_session(line, method)),
            "session/set_mode" => {
                log(&format!(
                    "set_mode {}",
                    string_after(line, "\"modeId\":").unwrap_or_default()
                ));
                Some("{}".to_string())
            }
            "session/close" => Some("{}".to_string()),
            "session/prompt" => self.prompt_result(line, id),
            _ => {
                send(
                    &mut self.stdout,
                    &format!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"error\":{{\"code\":-32601,\"message\":\"unknown method\"}}}}"),
                );
                None
            }
        }
    }

    fn initialize_result(&self) -> String {
        format!(
            "{{\"protocolVersion\":1,\"agentCapabilities\":{{\"loadSession\":{},\"sessionCapabilities\":{{{}}},\"mcpCapabilities\":{{\"http\":true}}}}}}",
            self.has("load"),
            [("resume", self.has("resume")), ("close", self.has("close"))]
                .iter()
                .filter(|(_, on)| *on)
                .map(|(name, _)| format!("\"{name}\":{{}}"))
                .collect::<Vec<_>>()
                .join(",")
        )
    }

    /// Takes up the session the request names; `session/load` replays its history.
    fn reopen_session(&mut self, line: &str, method: &str) -> String {
        if let Some(session) = string_after(line, "\"sessionId\":") {
            self.session = session;
        }
        keep_session(&self.session);
        if method == "session/load" {
            update(&mut self.stdout, &self.session, "replayed history");
        }
        format!("{{{}}}", self.modes.trim_start_matches(','))
    }

    /// The `result` for a prompt, or `None` when the turn is held open
    /// (waiting for a permission answer or a cancel).
    fn prompt_result(&mut self, line: &str, id: &str) -> Option<String> {
        let text = string_after(line, "\"text\":").unwrap_or_default();
        log(&format!("prompt {}", text.replace('\n', " ")));
        if self.ask {
            self.pending_prompt = Some(id.to_string());
            self.ask_permission();
            return None;
        }
        if self.slow {
            self.pending_prompt = Some(id.to_string());
            return None;
        }
        update(&mut self.stdout, &self.session, "done");
        Some("{\"stopReason\":\"end_turn\",\"usage\":{\"inputTokens\":3,\"outputTokens\":2,\"totalTokens\":5}}".to_string())
    }

    /// Asks permission to run the tool, after announcing it when asked to.
    fn ask_permission(&mut self) {
        let session = &self.session;
        let ask_tool = &self.ask_tool;
        if let Some(fields) = &self.announce {
            send(
                &mut self.stdout,
                &format!(
                    "{{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{{\"sessionId\":\"{session}\",\"update\":{{\"sessionUpdate\":\"tool_call\",\"title\":\"Tool\",{fields}}}}}}}"
                ),
            );
        }
        send(
            &mut self.stdout,
            &format!(
                "{{\"jsonrpc\":\"2.0\",\"id\":{PERMISSION_ID},\"method\":\"session/request_permission\",\"params\":{{\"sessionId\":\"{session}\",\"toolCall\":{ask_tool},\"options\":[{{\"optionId\":\"allow\",\"name\":\"Allow\",\"kind\":\"allow_once\"}},{{\"optionId\":\"reject\",\"name\":\"Reject\",\"kind\":\"reject_once\"}}]}}}}"
            ),
        );
    }
}

fn main() {
    let mut agent = Agent::from_env();
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            return;
        };
        agent.handle_line(&line);
    }
}
