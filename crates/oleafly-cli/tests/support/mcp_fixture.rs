//! A streamable-HTTP MCP server for tests: one `echo` tool (read only) and
//! one `write_note` tool, answered as JSON or as an event stream. It records
//! the headers each request carried.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Answers are `application/json`.
    Json,
    /// Answers are `text/event-stream`, with a notification first.
    Sse,
    /// Never answers.
    Silent,
}

/// One request the fixture received.
#[derive(Clone, Debug)]
pub struct Received {
    pub method: String,
    pub headers: Vec<(String, String)>,
}

impl Received {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub struct McpFixture {
    pub address: SocketAddr,
    pub received: Arc<Mutex<Vec<Received>>>,
}

impl McpFixture {
    pub fn url(&self) -> String {
        format!("http://{}/mcp", self.address)
    }

    pub fn received(&self) -> Vec<Received> {
        self.received.lock().unwrap().clone()
    }
}

pub const SESSION_ID: &str = "fixture-session-1";

fn tools() -> Value {
    json!({"tools": [
        {"name": "echo", "description": "Echo the text back.", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}, "annotations": {"readOnlyHint": true}},
        {"name": "write_note", "description": "Write a note.", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}},
    ]})
}

fn answer(message: &Value) -> Option<Value> {
    let id = message.get("id")?.clone();
    let result = match message["method"].as_str().unwrap_or_default() {
        "initialize" => json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "fixture", "version": "1"},
        }),
        "tools/list" => tools(),
        "tools/call" => {
            let text = message["params"]["arguments"]["text"]
                .as_str()
                .unwrap_or_default();
            match message["params"]["name"].as_str() {
                Some("echo") => json!({"content": [{"type": "text", "text": text}]}),
                _ => json!({"content": [{"type": "text", "text": "noted"}]}),
            }
        }
        _ => {
            return Some(
                json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "unknown"}}),
            )
        }
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

fn serve(stream: TcpStream, mode: Mode, received: Arc<Mutex<Vec<Received>>>) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(stream) => stream,
        Err(_) => return,
    });
    let mut stream = stream;
    loop {
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
            return;
        }
        let mut headers = Vec::new();
        let mut length = 0usize;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                return;
            }
            let line = line.trim_end();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                let (name, value) = (name.trim().to_string(), value.trim().to_string());
                if name.eq_ignore_ascii_case("content-length") {
                    length = value.parse().unwrap_or(0);
                }
                headers.push((name, value));
            }
        }
        let mut body = vec![0u8; length];
        if reader.read_exact(&mut body).is_err() {
            return;
        }
        if request_line.starts_with("DELETE") {
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let message: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        received.lock().unwrap().push(Received {
            method: message["method"].as_str().unwrap_or_default().to_string(),
            headers,
        });
        if mode == Mode::Silent {
            thread::sleep(std::time::Duration::from_secs(60));
            return;
        }
        let Some(reply) = answer(&message) else {
            let _ = stream.write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\n\r\n");
            continue;
        };
        let (content_type, payload) = match mode {
            Mode::Sse => (
                "text/event-stream",
                format!(
                    "event: message\ndata: {}\n\nevent: message\ndata: {}\n\n",
                    json!({"jsonrpc": "2.0", "method": "notifications/progress", "params": {}}),
                    reply
                ),
            ),
            _ => ("application/json", reply.to_string()),
        };
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nMcp-Session-Id: {SESSION_ID}\r\nContent-Length: {}\r\n\r\n{payload}",
            payload.len()
        );
        if stream.write_all(response.as_bytes()).is_err() {
            return;
        }
    }
}

/// Starts the fixture on a free local port.
pub fn start(mode: Mode) -> McpFixture {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    let shared = received.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let received = shared.clone();
            thread::spawn(move || serve(stream, mode, received));
        }
    });
    McpFixture { address, received }
}
