// A CLI agent for tests that speaks ACP version 1 over stdio, built with
// plain rustc (std only). Switches (environment):
// FIXTURE_CAPS   comma list of resume, load, close: what initialize offers
// FIXTURE_LOG    append "method <name>", "prompt <text>" and "permission
//                <answer>" lines to this file
// FIXTURE_ASK    on a prompt, ask permission to run a command first
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
    let digits: String = rest.chars().take_while(|character| character.is_ascii_digit() || *character == '-').collect();
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
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
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

fn main() {
    let caps = std::env::var("FIXTURE_CAPS").unwrap_or_default();
    let has = |name: &str| caps.split(',').any(|cap| cap.trim() == name);
    let ask = std::env::var("FIXTURE_ASK").is_ok();
    let slow = std::env::var("FIXTURE_SLOW").is_ok();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut session = String::from("agent-session-1");
    let mut pending_prompt: Option<String> = None;
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            return;
        };
        let method = string_after(&line, "\"method\":");
        let id = raw_after(&line, "\"id\":");
        if method.is_none() {
            // An answer to the permission request.
            if id.as_deref() == Some(PERMISSION_ID.to_string().as_str()) {
                log(&format!("permission {line}"));
                if let Some(prompt) = pending_prompt.take() {
                    update(&mut stdout, &session, "done");
                    send(&mut stdout, &format!("{{\"jsonrpc\":\"2.0\",\"id\":{prompt},\"result\":{{\"stopReason\":\"end_turn\"}}}}"));
                }
            }
            continue;
        }
        let method = method.unwrap_or_default();
        if method == "session/cancel" {
            log("method session/cancel");
            if let Some(prompt) = pending_prompt.take() {
                send(&mut stdout, &format!("{{\"jsonrpc\":\"2.0\",\"id\":{prompt},\"result\":{{\"stopReason\":\"cancelled\"}}}}"));
            }
            continue;
        }
        let Some(id) = id else {
            continue;
        };
        log(&format!("method {method}"));
        let result = match method.as_str() {
            "initialize" => format!(
                "{{\"protocolVersion\":1,\"agentCapabilities\":{{\"loadSession\":{},\"sessionCapabilities\":{{{}}},\"mcpCapabilities\":{{\"http\":true}}}}}}",
                has("load"),
                [("resume", has("resume")), ("close", has("close"))]
                    .iter()
                    .filter(|(_, on)| *on)
                    .map(|(name, _)| format!("\"{name}\":{{}}"))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            "session/new" => {
                keep_session(&session);
                format!("{{\"sessionId\":\"{session}\"}}")
            }
            "session/resume" | "session/load" => {
                session = string_after(&line, "\"sessionId\":").unwrap_or(session);
                keep_session(&session);
                if method == "session/load" {
                    update(&mut stdout, &session, "replayed history");
                }
                "{}".to_string()
            }
            "session/close" => "{}".to_string(),
            "session/prompt" => {
                let text = string_after(&line, "\"text\":").unwrap_or_default();
                log(&format!("prompt {}", text.replace('\n', " ")));
                if ask {
                    pending_prompt = Some(id);
                    send(
                        &mut stdout,
                        &format!(
                            "{{\"jsonrpc\":\"2.0\",\"id\":{PERMISSION_ID},\"method\":\"session/request_permission\",\"params\":{{\"sessionId\":\"{session}\",\"toolCall\":{{\"toolCallId\":\"tool-1\",\"title\":\"Run tests\",\"kind\":\"execute\",\"rawInput\":{{\"command\":\"make test\"}}}},\"options\":[{{\"optionId\":\"allow\",\"name\":\"Allow\",\"kind\":\"allow_once\"}},{{\"optionId\":\"reject\",\"name\":\"Reject\",\"kind\":\"reject_once\"}}]}}}}"
                        ),
                    );
                    continue;
                }
                if slow {
                    pending_prompt = Some(id);
                    continue;
                }
                update(&mut stdout, &session, "done");
                "{\"stopReason\":\"end_turn\",\"usage\":{\"inputTokens\":3,\"outputTokens\":2,\"totalTokens\":5}}".to_string()
            }
            _ => {
                send(
                    &mut stdout,
                    &format!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"error\":{{\"code\":-32601,\"message\":\"unknown method\"}}}}"),
                );
                continue;
            }
        };
        send(&mut stdout, &format!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{result}}}"));
    }
}
