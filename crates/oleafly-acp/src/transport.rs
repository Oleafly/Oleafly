use std::borrow::Cow;
use std::collections::VecDeque;
use std::io;

use agent_client_protocol::Lines;
use futures::{Sink, Stream};
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use crate::error::RpcError;
use crate::limits::{MAX_DROPPED_UPDATE, MAX_FRAME, WRITE_TIMEOUT};

pub const DROPPED_UPDATE_METHOD: &str = "_oleafly/dropped_update";

#[derive(Debug)]
pub enum Frame {
    Message(Value),
    DroppedUpdate { bytes: usize },
    TruncatedUpdate { bytes: usize, message: Value },
}

pub async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Value>, RpcError> {
    match read_frame_bytes(reader, MAX_FRAME).await? {
        Some(bytes) => parse_envelope(&bytes).map(Some),
        None => Ok(None),
    }
}

pub async fn read_agent_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Frame>, RpcError> {
    let Some(bytes) = read_frame_bytes(reader, MAX_DROPPED_UPDATE).await? else {
        return Ok(None);
    };
    if bytes.len() <= MAX_FRAME {
        return parse_envelope(&bytes).map(|value| Some(Frame::Message(value)));
    }
    match oversized_update(&bytes) {
        Some(Some(message)) => Ok(Some(Frame::TruncatedUpdate {
            bytes: bytes.len(),
            message,
        })),
        Some(None) => Ok(Some(Frame::DroppedUpdate { bytes: bytes.len() })),
        None => Err(RpcError::local(
            "The agent sent an ACP message larger than 1 MiB.",
        )),
    }
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum LooseText {
    Text(String),
    Other(serde::de::IgnoredAny),
}

impl LooseText {
    fn text(field: Option<Self>, limit: usize) -> Option<String> {
        match field? {
            Self::Text(text) if !text.is_empty() && text.len() <= limit => Some(text),
            _ => None,
        }
    }
}

fn oversized_update(bytes: &[u8]) -> Option<Option<Value>> {
    #[derive(serde::Deserialize)]
    struct Envelope {
        jsonrpc: Option<String>,
        method: Option<String>,
        id: Option<serde::de::IgnoredAny>,
    }
    #[derive(serde::Deserialize)]
    struct Identity {
        params: Option<Params>,
    }
    #[derive(serde::Deserialize)]
    struct Params {
        #[serde(rename = "sessionId")]
        session_id: Option<LooseText>,
        update: Option<Update>,
    }
    #[derive(serde::Deserialize)]
    struct Update {
        #[serde(rename = "sessionUpdate")]
        session_update: Option<LooseText>,
        #[serde(rename = "toolCallId")]
        tool_call_id: Option<LooseText>,
        status: Option<LooseText>,
        kind: Option<LooseText>,
        title: Option<LooseText>,
    }
    let envelope = serde_json::from_slice::<Envelope>(bytes).ok()?;
    if envelope.jsonrpc.as_deref() != Some("2.0")
        || envelope.method.as_deref() != Some("session/update")
        || envelope.id.is_some()
    {
        return None;
    }
    Some((|| {
        let params = serde_json::from_slice::<Identity>(bytes).ok()?.params?;
        let session_id = LooseText::text(params.session_id, 512)?;
        let update = params.update?;
        let kind = LooseText::text(update.session_update, 64)
            .filter(|kind| matches!(kind.as_str(), "tool_call" | "tool_call_update"))?;
        let tool_call_id = LooseText::text(update.tool_call_id, 512)?;
        let mut kept = serde_json::Map::new();
        kept.insert("sessionUpdate".into(), Value::String(kind));
        kept.insert("toolCallId".into(), Value::String(tool_call_id));
        for (key, field) in [
            ("status", update.status),
            ("kind", update.kind),
            ("title", update.title),
        ] {
            if let Some(text) = LooseText::text(field, 1024) {
                kept.insert(key.into(), Value::String(text));
            }
        }
        kept.insert("truncated".into(), Value::Bool(true));
        Some(json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {"sessionId": session_id, "update": kept},
        }))
    })())
}

fn parse_envelope(bytes: &[u8]) -> Result<Value, RpcError> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| RpcError::local("The agent sent invalid ACP JSON."))?;
    if value["jsonrpc"] != "2.0" || !value.is_object() {
        return Err(RpcError::local(
            "The agent sent an invalid JSON-RPC envelope.",
        ));
    }
    Ok(value)
}

async fn read_frame_bytes<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    limit: usize,
) -> Result<Option<Vec<u8>>, RpcError> {
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
        if bytes.len() + count > limit {
            return Err(RpcError::local(if limit > MAX_FRAME {
                "The agent sent an ACP message larger than 16 MiB."
            } else {
                "The agent sent an ACP message larger than 1 MiB."
            }));
        }
        bytes.extend_from_slice(&available[..count]);
        reader.consume(count);
        if newline.is_some() {
            if bytes.iter().all(u8::is_ascii_whitespace) {
                bytes.clear();
                continue;
            }
            return Ok(Some(bytes));
        }
    }
}

enum LineFrame {
    Line(String),
    Skip,
    Stray(Vec<u8>),
    Truncated { bytes: usize, message: Value },
    Dropped { bytes: usize },
}

fn checked_envelope(bytes: &[u8]) -> Result<Option<String>, RpcError> {
    #[derive(serde::Deserialize)]
    struct Envelope<'a> {
        #[serde(borrow)]
        jsonrpc: Option<Cow<'a, str>>,
        #[serde(borrow)]
        method: Option<Cow<'a, str>>,
    }
    let starts_as_object = bytes
        .iter()
        .find(|byte| !byte.is_ascii_whitespace())
        .is_some_and(|byte| *byte == b'{');
    let envelope = serde_json::from_slice::<Envelope<'_>>(bytes)
        .map_err(|_| RpcError::local("The agent sent invalid ACP JSON."))?;
    if !starts_as_object || envelope.jsonrpc.as_deref() != Some("2.0") {
        return Err(RpcError::local(
            "The agent sent an invalid JSON-RPC envelope.",
        ));
    }
    Ok(envelope.method.map(Cow::into_owned))
}

async fn read_line_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<LineFrame>, RpcError> {
    let Some(bytes) = read_frame_bytes(reader, MAX_DROPPED_UPDATE).await? else {
        return Ok(None);
    };
    if bytes.len() <= MAX_FRAME {
        let Ok(method) = checked_envelope(&bytes) else {
            return Ok(Some(LineFrame::Stray(bytes)));
        };
        if method
            .as_deref()
            .is_some_and(|method| method.starts_with("_oleafly/"))
        {
            return Ok(Some(LineFrame::Skip));
        }
        let text = String::from_utf8(bytes)
            .map_err(|_| RpcError::local("The agent sent invalid ACP JSON."))?;
        return Ok(Some(LineFrame::Line(
            text.trim_end_matches(['\r', '\n']).to_owned(),
        )));
    }
    match oversized_update(&bytes) {
        Some(Some(message)) => Ok(Some(LineFrame::Truncated {
            bytes: bytes.len(),
            message,
        })),
        Some(None) => Ok(Some(LineFrame::Dropped { bytes: bytes.len() })),
        None => match oversized_permission(&bytes) {
            Some(message) => Ok(Some(LineFrame::Truncated {
                bytes: bytes.len(),
                message,
            })),
            None => oversized_other(bytes),
        },
    }
}

fn oversized_other(bytes: Vec<u8>) -> Result<Option<LineFrame>, RpcError> {
    match checked_envelope(&bytes) {
        Ok(_) => Err(RpcError::local(
            "The agent sent an ACP message larger than 1 MiB.",
        )),
        Err(_) => Ok(Some(LineFrame::Stray(bytes))),
    }
}

fn oversized_permission(bytes: &[u8]) -> Option<Value> {
    let message: Value = serde_json::from_slice(bytes).ok()?;
    if message["jsonrpc"] != "2.0"
        || message["method"] != "session/request_permission"
        || message.get("id").is_none_or(Value::is_null)
    {
        return None;
    }
    let params = &message["params"];
    let call = &params["toolCall"];
    let mut kept = serde_json::Map::new();
    for key in ["toolCallId", "title", "kind", "status"] {
        if let Some(text) = call[key].as_str().filter(|text| text.len() <= 1024) {
            kept.insert(key.into(), Value::String(text.to_owned()));
        }
    }
    let diff_paths: Vec<&str> = call["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "diff")
        .filter_map(|item| item["path"].as_str())
        .collect();
    let mut paths: Vec<&str> = Vec::new();
    for path in crate::paths::permission_paths(call).chain(diff_paths.iter().copied()) {
        if path.len() <= 4096 && !paths.contains(&path) && paths.len() < 64 {
            paths.push(path);
        }
    }
    kept.insert(
        "locations".into(),
        Value::Array(paths.iter().map(|path| json!({"path": path})).collect()),
    );
    kept.insert(
        "content".into(),
        Value::Array(
            diff_paths
                .iter()
                .take(64)
                .map(|path| json!({"type": "diff", "path": path, "oldText": null, "newText": null}))
                .collect(),
        ),
    );
    let cut = json!({
        "jsonrpc": "2.0",
        "id": message["id"],
        "method": "session/request_permission",
        "params": {"sessionId": params["sessionId"], "toolCall": kept, "options": params["options"]},
    });
    (serde_json::to_vec(&cut).ok()?.len() < MAX_FRAME / 2).then_some(cut)
}

fn dropped_notice(bytes: usize) -> String {
    json!({"jsonrpc": "2.0", "method": DROPPED_UPDATE_METHOD, "params": {"bytes": bytes}})
        .to_string()
}

pub(crate) fn incoming_lines<R, F>(
    stdout: R,
    on_stray: F,
) -> impl Stream<Item = io::Result<String>> + Send + 'static
where
    R: AsyncRead + Send + Unpin + 'static,
    F: FnMut(&[u8]) + Send + 'static,
{
    futures::stream::unfold(
        Some((BufReader::new(stdout), VecDeque::<String>::new(), on_stray)),
        |state| async move {
            let (mut reader, mut queued, mut on_stray) = state?;
            loop {
                if let Some(line) = queued.pop_front() {
                    return Some((Ok(line), Some((reader, queued, on_stray))));
                }
                match read_line_frame(&mut reader).await {
                    Ok(None) => return None,
                    Ok(Some(LineFrame::Line(line))) => {
                        return Some((Ok(line), Some((reader, queued, on_stray))));
                    }
                    Ok(Some(LineFrame::Skip)) => {}
                    Ok(Some(LineFrame::Stray(bytes))) => on_stray(&bytes),
                    Ok(Some(LineFrame::Truncated { bytes, message })) => {
                        queued.push_back(message.to_string());
                        queued.push_back(dropped_notice(bytes));
                    }
                    Ok(Some(LineFrame::Dropped { bytes })) => {
                        queued.push_back(dropped_notice(bytes));
                    }
                    Err(error) => {
                        return Some((
                            Err(io::Error::new(io::ErrorKind::InvalidData, error.message)),
                            None,
                        ));
                    }
                }
            }
        },
    )
}

pub(crate) fn outgoing_lines<W>(stdin: W) -> impl Sink<String, Error = io::Error> + Send + 'static
where
    W: AsyncWrite + Send + Unpin + 'static,
{
    futures::sink::unfold(stdin, |mut stdin, line: String| async move {
        if line.len() + 1 >= MAX_FRAME {
            return Err(io::Error::other(
                "This ACP request exceeds the 1 MiB message limit.",
            ));
        }
        let mut bytes = line.into_bytes();
        bytes.push(b'\n');
        match tokio::time::timeout(WRITE_TIMEOUT, async {
            stdin.write_all(&bytes).await?;
            stdin.flush().await
        })
        .await
        {
            Ok(Ok(())) => Ok(stdin),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "The agent input is blocked.",
            )),
        }
    })
}

pub(crate) fn line_transport<R, W, F>(
    stdout: R,
    stdin: W,
    on_stray: F,
) -> Lines<
    impl Sink<String, Error = io::Error> + Send + 'static,
    impl Stream<Item = io::Result<String>> + Send + 'static,
>
where
    R: AsyncRead + Send + Unpin + 'static,
    W: AsyncWrite + Send + Unpin + 'static,
    F: FnMut(&[u8]) + Send + 'static,
{
    Lines::new(outgoing_lines(stdin), incoming_lines(stdout, on_stray))
}

#[cfg(test)]
mod tests;
