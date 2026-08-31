use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

// Large command results stream to the webview as ordered chunks over a
// Channel instead of one giant invoke return, mirrored by
// src/lib/chunked-ipc.ts. The receiver acks every chunk (`chunked_ack`); the
// sender keeps at most WINDOW chunks unacknowledged, so a slow webview slows
// the producer instead of buffering the whole payload in the IPC queue.
pub const MARKER: &str = "oleafly-chunked-message-v1";
pub const CHUNK_BYTES: usize = 256 * 1024;
const WINDOW: u64 = 4;
const ACK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChunkedMessage {
    Start {
        marker: &'static str,
        transfer_id: String,
        sequence: u64,
        total_bytes: u64,
    },
    Chunk {
        marker: &'static str,
        transfer_id: String,
        sequence: u64,
        data: String,
    },
    End {
        marker: &'static str,
        transfer_id: String,
        sequence: u64,
    },
}

impl ChunkedMessage {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn sequence(&self) -> u64 {
        match self {
            ChunkedMessage::Start { sequence, .. }
            | ChunkedMessage::Chunk { sequence, .. }
            | ChunkedMessage::End { sequence, .. } => *sequence,
        }
    }
}

/// Splits text into the ordered message sequence, respecting char boundaries.
/// The live send path slices lazily; this stays as the reference splitting
/// the tests assert against.
#[cfg_attr(not(test), allow(dead_code))]
pub fn chunk_text(transfer_id: &str, text: &str) -> Vec<ChunkedMessage> {
    let mut messages = vec![ChunkedMessage::Start {
        marker: MARKER,
        transfer_id: transfer_id.to_string(),
        sequence: 0,
        total_bytes: text.len() as u64,
    }];
    let mut sequence = 1;
    let mut rest = text;
    while !rest.is_empty() {
        let mut cut = rest.len().min(CHUNK_BYTES);
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        let (head, tail) = rest.split_at(cut);
        messages.push(ChunkedMessage::Chunk {
            marker: MARKER,
            transfer_id: transfer_id.to_string(),
            sequence,
            data: head.to_string(),
        });
        sequence += 1;
        rest = tail;
    }
    messages.push(ChunkedMessage::End {
        marker: MARKER,
        transfer_id: transfer_id.to_string(),
        sequence,
    });
    messages
}

static ACKS: Mutex<Option<HashMap<String, mpsc::UnboundedSender<u64>>>> = Mutex::new(None);

/// Removes the ack entry on drop, so a transfer future cancelled mid-send
/// (webview closed, command aborted) cannot leak its registry slot.
struct AckGuard(String);

impl Drop for AckGuard {
    fn drop(&mut self) {
        let mut acks = ACKS.lock().expect("chunked ack registry poisoned");
        if let Some(map) = acks.as_mut() {
            map.remove(&self.0);
        }
    }
}

fn register(transfer_id: &str) -> (AckGuard, mpsc::UnboundedReceiver<u64>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let mut acks = ACKS.lock().expect("chunked ack registry poisoned");
    acks.get_or_insert_with(HashMap::new)
        .insert(transfer_id.to_string(), tx);
    (AckGuard(transfer_id.to_string()), rx)
}

#[tauri::command]
pub fn chunked_ack(transfer_id: String, sequence: u64) {
    let acks = ACKS.lock().expect("chunked ack registry poisoned");
    if let Some(tx) = acks.as_ref().and_then(|map| map.get(&transfer_id)) {
        let _ = tx.send(sequence);
    }
}

/// Streams `text` over `channel` with ack-driven backpressure. Chunks are
/// sliced on the fly, so only the in-window copies exist at once instead of
/// the whole payload being materialized up front.
pub async fn send_chunked_text(
    channel: &Channel<ChunkedMessage>,
    text: &str,
) -> Result<(), String> {
    let transfer_id = uuid_like();
    let mut acked: u64 = 0;
    let (_guard, mut rx) = register(&transfer_id);
    channel
        .send(ChunkedMessage::Start {
            marker: MARKER,
            transfer_id: transfer_id.clone(),
            sequence: 0,
            total_bytes: text.len() as u64,
        })
        .map_err(|e| format!("chunked send failed: {e}"))?;
    let mut sequence: u64 = 1;
    let mut rest = text;
    while !rest.is_empty() {
        let mut cut = rest.len().min(CHUNK_BYTES);
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        let (head, tail) = rest.split_at(cut);
        channel
            .send(ChunkedMessage::Chunk {
                marker: MARKER,
                transfer_id: transfer_id.clone(),
                sequence,
                data: head.to_string(),
            })
            .map_err(|e| format!("chunked send failed: {e}"))?;
        while sequence.saturating_sub(acked) >= WINDOW {
            match tokio::time::timeout(ACK_TIMEOUT, rx.recv()).await {
                // An ack can only cover what was actually sent; a bogus
                // higher sequence must not disable backpressure.
                Ok(Some(sequence_acked)) => acked = acked.max(sequence_acked.min(sequence)),
                Ok(None) => return Err("chunked ack channel closed".to_string()),
                Err(_) => return Err("chunked ack timeout".to_string()),
            }
        }
        sequence += 1;
        rest = tail;
    }
    channel
        .send(ChunkedMessage::End {
            marker: MARKER,
            transfer_id: transfer_id.clone(),
            sequence,
        })
        .map_err(|e| format!("chunked send failed: {e}"))?;
    Ok(())
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("transfer-{nanos}-{:x}", std::process::id())
}

const MAX_APP_LOG_READ_BYTES: usize = 8 * 1024 * 1024;

#[tauri::command]
pub async fn read_app_log_chunked(
    max_bytes: usize,
    channel: Channel<ChunkedMessage>,
) -> Result<(), String> {
    let text = crate::project::read_app_log(max_bytes.min(MAX_APP_LOG_READ_BYTES))?;
    send_chunked_text(&channel, &text).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_one_chunk_between_start_and_end() {
        let messages = chunk_text("t", "hello");
        assert_eq!(messages.len(), 3);
        assert!(matches!(
            messages[0],
            ChunkedMessage::Start { total_bytes: 5, .. }
        ));
        assert!(
            matches!(&messages[1], ChunkedMessage::Chunk { data, sequence: 1, .. } if data == "hello")
        );
        assert!(matches!(
            messages[2],
            ChunkedMessage::End { sequence: 2, .. }
        ));
    }

    #[test]
    fn long_text_splits_on_char_boundaries_in_order() {
        let text = "é".repeat(CHUNK_BYTES);
        let messages = chunk_text("t", &text);
        let mut rebuilt = String::new();
        for (index, message) in messages.iter().enumerate() {
            assert_eq!(message.sequence(), index as u64);
            if let ChunkedMessage::Chunk { data, .. } = message {
                rebuilt.push_str(data);
            }
        }
        assert_eq!(rebuilt, text);
        assert!(messages.len() > 3);
    }

    #[test]
    fn empty_text_is_start_then_end() {
        let messages = chunk_text("t", "");
        assert_eq!(messages.len(), 2);
        assert!(matches!(
            messages[1],
            ChunkedMessage::End { sequence: 1, .. }
        ));
    }

    #[test]
    fn acks_are_ignored_for_unknown_transfers() {
        chunked_ack("nobody".to_string(), 7);
    }
}
