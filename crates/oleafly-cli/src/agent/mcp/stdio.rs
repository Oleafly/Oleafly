//! An MCP server that runs as a program: newline-delimited JSON-RPC over its
//! stdin and stdout. Its stderr is kept in a small buffer and never printed
//! (servers print their configuration there, keys included).
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::oneshot;

use super::{resolve_program, MAX_FRAME_BYTES};
use crate::agent::tools::command_env;
use crate::app_paths::Platform;

const STDERR_RING_BYTES: usize = 64 * 1024;
const STOP_WAIT: Duration = Duration::from_secs(2);

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;
type Writer = Arc<tokio::sync::Mutex<Option<ChildStdin>>>;

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub struct StdioConnection {
    writer: Writer,
    pending: Pending,
    next_id: AtomicU64,
    child: tokio::sync::Mutex<Option<Child>>,
    tree: Mutex<Option<oleafly_sandbox::process::ProcessTreeGuard>>,
    /// The end of what the server wrote to stderr (never shown; tests read
    /// its size).
    #[cfg_attr(not(test), allow(dead_code))]
    stderr: Arc<Mutex<VecDeque<u8>>>,
    closed: Arc<AtomicBool>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

/// Reads one line of at most `max` bytes into `line` (without the newline).
/// `Ok(false)` at the end of the stream.
pub(crate) async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<bool> {
    line.clear();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(!line.is_empty());
        }
        match available.iter().position(|byte| *byte == b'\n') {
            Some(newline) => {
                line.extend_from_slice(&available[..newline]);
                reader.consume(newline + 1);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return Ok(true);
            }
            None => {
                let count = available.len();
                line.extend_from_slice(available);
                reader.consume(count);
            }
        }
        if line.len() > max {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "message too large",
            ));
        }
    }
}

async fn write_line(writer: &Writer, message: &Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    line.push(b'\n');
    let mut guard = writer.lock().await;
    let stdin = guard.as_mut().ok_or("the server has stopped")?;
    stdin
        .write_all(&line)
        .await
        .map_err(|_| "the server stopped reading".to_string())?;
    stdin
        .flush()
        .await
        .map_err(|_| "the server stopped reading".to_string())
}

fn fail_all(pending: &Pending, message: &str) {
    for (_, sender) in lock(pending).drain() {
        let _ = sender.send(Err(message.to_string()));
    }
}

/// An error object's message, cut short.
fn error_message(error: &Value) -> String {
    let message = error["message"]
        .as_str()
        .unwrap_or("the server reported an error");
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(400)
        .collect()
}

async fn route(message: Value, pending: &Pending, writer: &Writer) {
    let id = message.get("id").cloned();
    if let Some(method) = message["method"].as_str() {
        // A request from the server (a notification has no id).
        if let Some(id) = id.filter(|id| !id.is_null()) {
            let reply = if method == "ping" {
                json!({"jsonrpc": "2.0", "id": id, "result": {}})
            } else {
                json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "Oleafly does not support this request."}})
            };
            let _ = write_line(writer, &reply).await;
        }
        return;
    }
    let Some(number) = id.as_ref().and_then(Value::as_u64) else {
        return;
    };
    let Some(sender) = lock(pending).remove(&number) else {
        return;
    };
    let outcome = match message.get("error") {
        Some(error) if !error.is_null() => Err(error_message(error)),
        _ => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    };
    let _ = sender.send(outcome);
}

impl StdioConnection {
    /// Starts `command` with the server's own environment over the user's
    /// (provider keys left out).
    pub async fn spawn(
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
    ) -> Result<Self, String> {
        let platform = Platform::current();
        let path = std::env::var_os("PATH");
        let pathext = std::env::var_os("PATHEXT");
        let program = resolve_program(
            command,
            platform,
            path.as_deref(),
            pathext.as_deref(),
            &|candidate| candidate.is_file(),
        )
        .ok_or_else(|| format!("{command} was not found"))?;
        let mut process = tokio::process::Command::new(&program);
        process
            .args(args)
            .env_clear()
            .envs(command_env(std::env::vars_os()))
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        oleafly_sandbox::process::isolate_process_tree(&mut process);
        let mut child = process
            .spawn()
            .map_err(|error| format!("it could not start ({})", error.kind()))?;
        let pid = child.id().ok_or("it stopped at once")?;
        let tree = match oleafly_sandbox::process::contain_process_tree(pid) {
            Ok(tree) => tree,
            Err(_) => {
                let _ = child.start_kill();
                return Err("it could not be contained".into());
            }
        };
        let stdin = child.stdin.take().ok_or("its input is unavailable")?;
        let stdout = child.stdout.take().ok_or("its output is unavailable")?;
        let stderr = child.stderr.take().ok_or("its errors are unavailable")?;
        let writer: Writer = Arc::new(tokio::sync::Mutex::new(Some(stdin)));
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let ring = Arc::new(Mutex::new(VecDeque::with_capacity(4096)));
        let reader = {
            let pending = pending.clone();
            let writer = writer.clone();
            let closed = closed.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut line = Vec::new();
                loop {
                    match read_frame(&mut reader, &mut line, MAX_FRAME_BYTES).await {
                        Ok(true) => {
                            let text = String::from_utf8_lossy(&line);
                            if text.trim().is_empty() {
                                continue;
                            }
                            if let Ok(message) = serde_json::from_str::<Value>(text.trim()) {
                                route(message, &pending, &writer).await;
                            }
                        }
                        Ok(false) => break,
                        Err(_) => break,
                    }
                }
                closed.store(true, Ordering::Release);
                fail_all(&pending, "the server closed its connection");
            })
        };
        let errors = {
            let ring = ring.clone();
            tokio::spawn(async move {
                let mut stderr = stderr;
                let mut buffer = [0u8; 4096];
                while let Ok(count) = stderr.read(&mut buffer).await {
                    if count == 0 {
                        break;
                    }
                    let mut ring = lock(&ring);
                    ring.extend(&buffer[..count]);
                    while ring.len() > STDERR_RING_BYTES {
                        ring.pop_front();
                    }
                }
            })
        };
        Ok(Self {
            writer,
            pending,
            next_id: AtomicU64::new(1),
            child: tokio::sync::Mutex::new(Some(child)),
            tree: Mutex::new(Some(tree)),
            stderr: ring,
            closed,
            tasks: Mutex::new(vec![reader, errors]),
        })
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("the server has stopped".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::AcqRel);
        let (sender, receiver) = oneshot::channel();
        lock(&self.pending).insert(id, sender);
        let message = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        if let Err(error) = write_line(&self.writer, &message).await {
            lock(&self.pending).remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err("the server closed its connection".into()),
            Err(_) => {
                lock(&self.pending).remove(&id);
                let _ = write_line(
                    &self.writer,
                    &json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": id, "reason": "timeout"}}),
                )
                .await;
                Err(format!(
                    "it did not answer within {} seconds",
                    timeout.as_secs()
                ))
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        write_line(
            &self.writer,
            &json!({"jsonrpc": "2.0", "method": method, "params": params}),
        )
        .await
    }

    /// How many bytes of stderr are kept (for tests; never shown).
    #[cfg(test)]
    pub fn stderr_len(&self) -> usize {
        lock(&self.stderr).len()
    }

    /// Stops the server and its children.
    pub async fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.writer.lock().await.take();
        if let Some(mut child) = self.child.lock().await.take() {
            if tokio::time::timeout(STOP_WAIT, child.wait()).await.is_err() {
                let _ = child.start_kill();
                let _ = tokio::time::timeout(STOP_WAIT, child.wait()).await;
            }
        }
        lock(&self.tree).take();
        for task in lock(&self.tasks).drain(..) {
            task.abort();
        }
        fail_all(&self.pending, "the server has stopped");
    }
}

impl Drop for StdioConnection {
    fn drop(&mut self) {
        lock(&self.tree).take();
        for task in lock(&self.tasks).drain(..) {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frames_are_read_line_by_line_and_bounded() {
        let data: &[u8] = b"{\"a\":1}\r\n{\"b\":2}\nlast";
        let mut reader = BufReader::new(data);
        let mut line = Vec::new();
        assert!(read_frame(&mut reader, &mut line, 64).await.unwrap());
        assert_eq!(line, b"{\"a\":1}");
        assert!(read_frame(&mut reader, &mut line, 64).await.unwrap());
        assert_eq!(line, b"{\"b\":2}");
        assert!(read_frame(&mut reader, &mut line, 64).await.unwrap());
        assert_eq!(line, b"last");
        assert!(!read_frame(&mut reader, &mut line, 64).await.unwrap());
        let big = [b'x'; 200];
        let mut reader = BufReader::new(&big[..]);
        assert!(read_frame(&mut reader, &mut line, 64).await.is_err());
    }

    #[tokio::test]
    async fn a_missing_program_is_reported_without_its_environment() {
        let env = BTreeMap::from([("TOKEN".to_string(), "s3cret-token".to_string())]);
        let error = match StdioConnection::spawn("/no/such/program", &[], &env).await {
            Ok(_) => panic!("a missing program must not start"),
            Err(error) => error,
        };
        assert!(!error.contains("s3cret-token"));
    }
}
