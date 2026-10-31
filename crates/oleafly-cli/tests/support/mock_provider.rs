//! An OpenAI-compatible chat provider for tests: each request gets the next
//! scripted reply as a server-sent event stream. It records every request
//! body, so tests can check the tools and messages a run sent.
#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

#[derive(Clone, Debug)]
pub enum Step {
    ToolCall { name: String, arguments: String },
    Text(String),
    Status { code: u16, body: String },
    Stall,
}

pub fn tool_call(name: &str, arguments: &str) -> Step {
    Step::ToolCall {
        name: name.into(),
        arguments: arguments.into(),
    }
}

pub fn text(text: &str) -> Step {
    Step::Text(text.into())
}

pub struct MockProvider {
    pub address: SocketAddr,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl MockProvider {
    pub fn script(steps: Vec<Step>) -> MockProvider {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let steps = Arc::new(Mutex::new(
            steps.into_iter().collect::<std::collections::VecDeque<_>>(),
        ));
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let recorded = recorded.clone();
                let steps = steps.clone();
                thread::spawn(move || handle(stream, &recorded, &steps));
            }
        });
        MockProvider { address, requests }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}/v1", self.address)
    }

    pub fn requests(&self) -> Vec<Value> {
        self.requests.lock().unwrap().clone()
    }

    pub fn tool_names(&self, index: usize) -> Vec<String> {
        self.requests()
            .get(index)
            .and_then(|request| request["tools"].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|tool| tool["function"]["name"].as_str().map(str::to_owned))
            .collect()
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Vec<u8>> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .ok()?;
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..read]);
        let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
        let length = headers
            .lines()
            .find_map(|line| {
                line.strip_prefix("content-length:")
                    .map(|value| value.trim().parse::<usize>().unwrap_or(0))
            })
            .unwrap_or(0);
        if bytes.len() >= end + 4 + length {
            return Some(bytes[end + 4..end + 4 + length].to_vec());
        }
    }
}

fn chunk(value: Value) -> String {
    format!("data: {value}\n\n")
}

fn stream_body(step: &Step) -> String {
    let usage = json!({"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16});
    match step {
        Step::ToolCall { name, arguments } => {
            let id = format!("call_{}", rand_suffix());
            [
                chunk(json!({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": id, "type": "function", "function": {"name": name, "arguments": ""}}]}}]})),
                chunk(json!({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": arguments}}]}}]})),
                chunk(json!({"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]})),
                chunk(json!({"choices": [], "usage": usage})),
                "data: [DONE]\n\n".to_string(),
            ]
            .concat()
        }
        Step::Text(text) => [
            chunk(json!({"choices": [{"index": 0, "delta": {"content": text}}]})),
            chunk(json!({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})),
            chunk(json!({"choices": [], "usage": usage})),
            "data: [DONE]\n\n".to_string(),
        ]
        .concat(),
        Step::Status { .. } | Step::Stall => String::new(),
    }
}

fn rand_suffix() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn handle(
    mut stream: TcpStream,
    recorded: &Mutex<Vec<Value>>,
    steps: &Mutex<std::collections::VecDeque<Step>>,
) {
    let Some(body) = read_request(&mut stream) else {
        return;
    };
    recorded
        .lock()
        .unwrap()
        .push(serde_json::from_slice(&body).unwrap_or(Value::Null));
    let step = steps
        .lock()
        .unwrap()
        .pop_front()
        .unwrap_or_else(|| Step::Text("Done".into()));
    match step {
        Step::Stall => {
            thread::sleep(Duration::from_secs(600));
        }
        Step::Status { code, body } => {
            let _ = write!(
                stream,
                "HTTP/1.1 {code} Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
        step => {
            let body = stream_body(&step);
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    }
    let _ = stream.flush();
}
