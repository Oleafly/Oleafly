//! `oleafly mcp` without the app: MCP over stdio, one JSON-RPC message per
//! line. stdout carries only protocol messages; anything for people goes to
//! stderr.
use std::collections::HashMap;
use std::sync::Arc;

use oleafly_research::mcp::protocol::{
    dispatch_with, rpc_error, rpc_tool_error, tool_result, RpcOutcome, ServerInfo,
};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, Semaphore};

use super::tools::{all_tools, call_tool, ToolContext};
use crate::contract::CliError;

pub(crate) const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_CONCURRENT_CALLS: usize = 4;

/// One stdin line: a message to handle, or a protocol error to send back.
pub(crate) enum Line {
    Message(Value),
    Reply(Value),
}

/// Reads stdin line by line, capping each line at 4 MiB.
pub(crate) struct StdinLines {
    reader: BufReader<tokio::io::Stdin>,
}

impl StdinLines {
    pub fn new() -> Self {
        Self {
            reader: BufReader::new(tokio::io::stdin()),
        }
    }

    /// The next line (blank lines skipped), or `None` at end of input.
    pub async fn next(&mut self) -> Option<Line> {
        loop {
            let mut line: Vec<u8> = Vec::new();
            let mut oversized = false;
            loop {
                let buffer = match self.reader.fill_buf().await {
                    Ok(buffer) => buffer,
                    Err(_) => return None,
                };
                if buffer.is_empty() {
                    if line.is_empty() && !oversized {
                        return None;
                    }
                    break;
                }
                match buffer.iter().position(|byte| *byte == b'\n') {
                    Some(newline) => {
                        if !oversized && line.len() + newline <= MAX_LINE_BYTES {
                            line.extend_from_slice(&buffer[..newline]);
                        } else {
                            oversized = true;
                        }
                        self.reader.consume(newline + 1);
                        break;
                    }
                    None => {
                        let length = buffer.len();
                        if !oversized && line.len() + length <= MAX_LINE_BYTES {
                            line.extend_from_slice(buffer);
                        } else {
                            oversized = true;
                            line.clear();
                        }
                        self.reader.consume(length);
                    }
                }
            }
            if oversized {
                return Some(Line::Reply(rpc_error(
                    Value::Null,
                    -32600,
                    "The message is larger than 4 MiB.",
                )));
            }
            let text = String::from_utf8_lossy(&line);
            if text.trim().is_empty() {
                continue;
            }
            return Some(classify(&text));
        }
    }
}

pub(crate) fn classify(text: &str) -> Line {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(_)) => {
            Line::Reply(rpc_error(Value::Null, -32600, "Batches aren't supported."))
        }
        Ok(value @ Value::Object(_)) => Line::Message(value),
        Ok(_) => Line::Reply(rpc_error(
            Value::Null,
            -32600,
            "A message must be a JSON object.",
        )),
        Err(_) => Line::Reply(rpc_error(
            Value::Null,
            -32700,
            "The message isn't valid JSON.",
        )),
    }
}

pub(crate) fn instructions(root: &std::path::Path) -> String {
    format!(
        "Oleafly's command-line server for the LaTeX, Typst or Markdown project in {}. Start with get_status or project_map. compile builds the PDF and returns errors with file and line. Edit files with your own tools; this server reads files and builds.",
        root.display()
    )
}

async fn write_line(stdout: &Mutex<tokio::io::Stdout>, value: &Value) {
    let mut stdout = stdout.lock().await;
    let _ = stdout.write_all(value.to_string().as_bytes()).await;
    let _ = stdout.write_all(b"\n").await;
    let _ = stdout.flush().await;
}

/// The key a request id is tracked under (for cancellation).
fn id_key(id: &Value) -> String {
    id.to_string()
}

/// Serves MCP on stdio until stdin closes, or until a signal asks it to stop
/// (SIGTERM, SIGHUP or Ctrl+C), so the commands its tools started end with it.
pub(crate) async fn serve_headless(context: ToolContext) -> Result<(), CliError> {
    let tools = all_tools();
    let instructions = instructions(&context.root);
    let server = ServerInfo {
        name: "oleafly",
        title: "Oleafly",
        version: crate::version::APP_VERSION,
    };
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let context = Arc::new(context);
    let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_CALLS));
    let in_flight: Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let mut tasks = tokio::task::JoinSet::new();
    let mut lines = StdinLines::new();
    let mut stop = std::pin::pin!(crate::daemon::serve::termination());
    loop {
        let next = tokio::select! {
            line = lines.next() => line,
            () = &mut stop => None,
        };
        let Some(line) = next else { break };
        let message = match line {
            Line::Message(message) => message,
            Line::Reply(reply) => {
                write_line(&stdout, &reply).await;
                continue;
            }
        };
        if message.get("method").and_then(Value::as_str) == Some("notifications/cancelled") {
            if let Some(request) = message.pointer("/params/requestId") {
                if let Some(handle) = in_flight.lock().await.remove(&id_key(request)) {
                    handle.abort();
                }
            }
            continue;
        }
        match dispatch_with(&message, &tools, &instructions, &server) {
            RpcOutcome::Reply(reply) => write_line(&stdout, &reply).await,
            RpcOutcome::Accepted => {}
            RpcOutcome::ForwardCall {
                id,
                name,
                arguments,
            } => {
                let stdout = stdout.clone();
                let context = context.clone();
                let slots = slots.clone();
                let in_flight_for_task = in_flight.clone();
                let key = id_key(&id);
                let task_key = key.clone();
                // Tracked before the task can finish, so its reply is never
                // mistaken for a cancelled one.
                let mut tracked = in_flight.lock().await;
                let handle = tasks.spawn(async move {
                    let Ok(_permit) = slots.acquire_owned().await else {
                        return;
                    };
                    let reply = match call_tool(&name, &arguments, &context).await {
                        Ok(structured) => tool_result(id, structured),
                        Err(error) => rpc_tool_error(id, &error.0),
                    };
                    // A cancelled call is no longer tracked; its reply is dropped.
                    if in_flight_for_task.lock().await.remove(&task_key).is_some() {
                        write_line(&stdout, &reply).await;
                    }
                });
                tracked.insert(key, handle);
                drop(tracked);
            }
        }
        while tasks.try_join_next().is_some() {}
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_or_garbage_line_gets_a_protocol_error_not_a_crash() {
        let Line::Reply(batch) = classify("[{\"jsonrpc\":\"2.0\"}]") else {
            panic!("expected a reply")
        };
        assert_eq!(batch["error"]["code"], -32600);
        assert_eq!(batch["id"], Value::Null);
        let Line::Reply(garbage) = classify("{not json") else {
            panic!("expected a reply")
        };
        assert_eq!(garbage["error"]["code"], -32700);
        assert!(matches!(
            classify("{\"jsonrpc\":\"2.0\",\"method\":\"ping\",\"id\":1}"),
            Line::Message(_)
        ));
    }

    #[test]
    fn instructions_name_the_project() {
        assert!(instructions(std::path::Path::new("/p/thesis")).contains("/p/thesis"));
    }
}
