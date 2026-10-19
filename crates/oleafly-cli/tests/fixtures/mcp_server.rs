// A stdio MCP server for tests, built with plain rustc (std only).
// Tools: `echo` (read only) returns its `text`; `write_note` returns "noted".
// Switches (environment):
// FIXTURE_SILENT=1   never answer
// FIXTURE_ECHO_ENV   print this variable's value to stderr at start (the
//                    client must never show it)
use std::io::{BufRead, Write};

fn number_after(line: &str, key: &str) -> Option<String> {
    let start = line.find(key)? + key.len();
    let rest = line[start..].trim_start();
    let digits: String = rest.chars().take_while(|character| character.is_ascii_digit()).collect();
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

fn quote(text: &str) -> String {
    let mut quoted = String::from("\"");
    for character in text.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\t' => quoted.push_str("\\t"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

fn main() {
    if let Ok(name) = std::env::var("FIXTURE_ECHO_ENV") {
        eprintln!("{name}={}", std::env::var(&name).unwrap_or_default());
    }
    let silent = std::env::var("FIXTURE_SILENT").is_ok();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            return;
        };
        if silent {
            continue;
        }
        let Some(id) = number_after(&line, "\"id\":") else {
            continue;
        };
        let method = string_after(&line, "\"method\":").unwrap_or_default();
        let result = match method.as_str() {
            "initialize" => "{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}".to_string(),
            "tools/list" => "{\"tools\":[{\"name\":\"echo\",\"description\":\"Echo the text back.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}}},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"write_note\",\"description\":\"Write a note.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}}}}]}".to_string(),
            "tools/call" => {
                let name = string_after(&line, "\"name\":").unwrap_or_default();
                let text = if name == "echo" {
                    string_after(&line, "\"text\":").unwrap_or_default()
                } else {
                    "noted".to_string()
                };
                format!("{{\"content\":[{{\"type\":\"text\",\"text\":{}}}]}}", quote(&text))
            }
            _ => {
                let _ = writeln!(
                    stdout,
                    "{{\"jsonrpc\":\"2.0\",\"id\":{id},\"error\":{{\"code\":-32601,\"message\":\"unknown method\"}}}}"
                );
                let _ = stdout.flush();
                continue;
            }
        };
        let _ = writeln!(stdout, "{{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{result}}}");
        let _ = stdout.flush();
    }
}
