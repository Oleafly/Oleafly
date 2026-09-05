use serde_json::{json, Value};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot, watch},
};

pub const MAX_FRAME: usize = 1024 * 1024;
const MAX_PENDING: usize = 32;
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>>;

#[derive(Clone, Debug)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

impl RpcError {
    pub fn local(message: &str) -> Self {
        Self {
            code: -32603,
            message: message.into(),
        }
    }
    pub fn auth_required(&self) -> bool {
        self.code == -32000
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

#[derive(Debug)]
pub enum Incoming {
    Message(Value),
    Barrier(oneshot::Sender<()>),
    Disconnected,
}

pub struct Connection {
    outgoing: mpsc::Sender<Value>,
    pending: Pending,
    next_id: AtomicU64,
    stop: watch::Sender<bool>,
    closed: watch::Receiver<bool>,
}

pub async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Value>, RpcError> {
    let mut bytes = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|_| RpcError::local("The agent output could not be read."))?;
        if available.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                Err(RpcError::local("The agent sent an incomplete ACP message."))
            };
        }
        let newline = available.iter().position(|b| *b == b'\n');
        let count = newline.map(|v| v + 1).unwrap_or(available.len());
        if bytes.len() + count > MAX_FRAME {
            return Err(RpcError::local(
                "The agent sent an ACP message larger than 1 MiB.",
            ));
        }
        bytes.extend_from_slice(&available[..count]);
        reader.consume(count);
        if newline.is_some() {
            if bytes.iter().all(u8::is_ascii_whitespace) {
                bytes.clear();
                continue;
            }
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| RpcError::local("The agent sent invalid ACP JSON."))?;
            if value["jsonrpc"] != "2.0" || !value.is_object() {
                return Err(RpcError::local(
                    "The agent sent an invalid JSON-RPC envelope.",
                ));
            }
            return Ok(Some(value));
        }
    }
}

impl Connection {
    pub async fn spawn(
        mut command: tokio::process::Command,
    ) -> Result<(Arc<Self>, mpsc::Receiver<Incoming>), String> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        crate::proc::isolate_process_tree(&mut command);
        let mut child = command.spawn().map_err(|_| {
            "The agent could not be started. Check its installation and executable permissions."
        })?;
        let pid = child.id().ok_or("The agent process has no ID.")?;
        let guard = match crate::proc::contain_process_tree(pid) {
            Ok(guard) => guard,
            Err(_) => {
                let _ = child.kill().await;
                return Err("The agent process could not be contained.".into());
            }
        };
        let mut stdin = child.stdin.take().ok_or("The agent has no input stream.")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("The agent has no output stream.")?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or("The agent has no error stream.")?;
        let (outgoing, mut outgoing_rx) = mpsc::channel::<Value>(64);
        let (incoming_tx, incoming_rx) = mpsc::channel(256);
        let (stop, mut stop_rx) = watch::channel(false);
        let (closed_tx, closed) = watch::channel(false);
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = pending.clone();
        let reader_incoming = incoming_tx.clone();
        let reader_stop = stop.clone();
        let mut reader = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(value)) = read_frame(&mut reader).await {
                if value.get("method").is_none() {
                    if let Some(id) = value["id"].as_u64() {
                        let sender = reader_pending
                            .lock()
                            .ok()
                            .and_then(|mut map| map.remove(&id));
                        if let Some(sender) = sender {
                            let (barrier, processed) = oneshot::channel();
                            if reader_incoming
                                .send(Incoming::Barrier(barrier))
                                .await
                                .is_err()
                                || processed.await.is_err()
                            {
                                break;
                            }
                            let response = if value.get("error").is_some() {
                                Err(RpcError { code: value["error"]["code"].as_i64().unwrap_or(-32603), message: "The agent could not complete this request. Check the CLI sign-in and selected model.".into() })
                            } else if let Some(result) = value.get("result") {
                                Ok(result.clone())
                            } else {
                                Err(RpcError::local("The agent returned an invalid response."))
                            };
                            let _ = sender.send(response);
                        }
                    }
                } else if reader_incoming
                    .send(Incoming::Message(value))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            let (barrier, processed) = oneshot::channel();
            if reader_incoming
                .send(Incoming::Barrier(barrier))
                .await
                .is_ok()
            {
                let _ = processed.await;
            }
            let _ = reader_stop.send(true);
        });
        let writer_stop = stop.clone();
        let writer = tokio::spawn(async move {
            while let Some(value) = outgoing_rx.recv().await {
                let Ok(mut bytes) = serde_json::to_vec(&value) else {
                    break;
                };
                if bytes.len() >= MAX_FRAME {
                    break;
                }
                bytes.push(b'\n');
                if tokio::time::timeout(Duration::from_secs(10), stdin.write_all(&bytes))
                    .await
                    .map_or(true, |r| r.is_err())
                {
                    break;
                }
            }
            let _ = writer_stop.send(true);
        });
        let diagnostics = tokio::spawn(async move {
            let mut buffer = [0u8; 8192];
            loop {
                match stderr.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });
        let cleanup_pending = pending.clone();
        tokio::spawn(async move {
            tokio::select! { _ = stop_rx.changed() => {}, _ = child.wait() => { let _ = tokio::time::timeout(Duration::from_millis(500), &mut reader).await; } }
            drop(guard);
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            reader.abort();
            writer.abort();
            diagnostics.abort();
            if let Ok(mut entries) = cleanup_pending.lock() {
                for (_, sender) in entries.drain() {
                    let _ = sender.send(Err(RpcError::local("The agent disconnected.")));
                }
            }
            let _ = closed_tx.send(true);
            let _ = incoming_tx.send(Incoming::Disconnected).await;
        });
        Ok((
            Arc::new(Self {
                outgoing,
                pending,
                next_id: AtomicU64::new(1),
                stop,
                closed,
            }),
            incoming_rx,
        ))
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        deadline: Duration,
    ) -> Result<Value, RpcError> {
        if *self.closed.borrow() {
            return Err(RpcError::local("The agent is disconnected."));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| RpcError::local("The ACP connection is unavailable."))?;
            if pending.len() >= MAX_PENDING {
                return Err(RpcError::local("Too many ACP requests are pending."));
            }
            pending.insert(id, sender);
        }
        struct PendingGuard {
            pending: Pending,
            id: u64,
        }
        impl Drop for PendingGuard {
            fn drop(&mut self) {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&self.id);
                }
            }
        }
        let _pending = PendingGuard {
            pending: self.pending.clone(),
            id,
        };
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .await?;
        match tokio::time::timeout(deadline, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(RpcError::local("The agent disconnected before replying.")),
            Err(_) => {
                let _ = self.stop.send(true);
                Err(RpcError::local(
                    "The agent did not reply in time and was stopped.",
                ))
            }
        }
    }

    pub async fn send(&self, value: Value) -> Result<(), RpcError> {
        if serde_json::to_vec(&value).map_or(true, |bytes| bytes.len() >= MAX_FRAME) {
            return Err(RpcError::local(
                "This ACP request exceeds the 1 MiB message limit.",
            ));
        }
        tokio::time::timeout(Duration::from_secs(5), self.outgoing.send(value))
            .await
            .map_err(|_| RpcError::local("The agent input is blocked."))?
            .map_err(|_| RpcError::local("The agent is disconnected."))
    }

    pub async fn shutdown(&self) {
        let _ = self.stop.send(true);
        let mut closed = self.closed.clone();
        if !*closed.borrow() {
            let _ =
                tokio::time::timeout(Duration::from_secs(7), closed.wait_for(|value| *value)).await;
        }
    }

    pub fn request_stop(&self) {
        let _ = self.stop.send(true);
    }

    pub fn is_closed(&self) -> bool {
        *self.closed.borrow()
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}
