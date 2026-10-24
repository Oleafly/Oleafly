//! Streamed text chunks are joined before they are stored: one event per
//! 100 ms (or 64 KiB) of the same message instead of one per token.
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const FLUSH_AFTER: Duration = Duration::from_millis(100);
const FLUSH_BYTES: usize = 64 * 1024;

struct Held {
    kind: String,
    turn: Option<String>,
    message_id: Option<String>,
    text: String,
    first_at: Instant,
}

#[derive(Default)]
pub(super) struct Coalescer {
    held: Option<Held>,
}

pub(super) enum Pushed {
    /// The chunk is held with earlier text of the same message.
    Held,
    /// Earlier text of another message, to store before the new chunk.
    Flush(Value),
}

/// The text of a plain text chunk, or `None` for anything else (images,
/// resources, v2 replacements), which is stored as it is.
pub(super) fn chunk_text(update: &Value) -> Option<&str> {
    if update["replace"].as_bool() == Some(true) || update["content"]["type"] != "text" {
        return None;
    }
    update["content"]["text"].as_str()
}

impl Coalescer {
    /// Holds a text chunk (see [`chunk_text`]). Held text of another
    /// message comes back to be stored before this one.
    pub fn push(
        &mut self,
        kind: &str,
        turn: Option<&str>,
        message_id: Option<&str>,
        text: &str,
        now: Instant,
    ) -> Pushed {
        if let Some(held) = &mut self.held {
            if held.kind == kind
                && held.turn.as_deref() == turn
                && held.message_id.as_deref() == message_id
            {
                held.text.push_str(text);
                return Pushed::Held;
            }
        }
        let previous = self.take();
        self.held = Some(Held {
            kind: kind.to_owned(),
            turn: turn.map(str::to_owned),
            message_id: message_id.map(str::to_owned),
            text: text.to_owned(),
            first_at: now,
        });
        match previous {
            Some(previous) => Pushed::Flush(previous),
            None => Pushed::Held,
        }
    }

    /// The held text as one chunk update.
    pub fn take(&mut self) -> Option<Value> {
        let held = self.held.take()?;
        let mut update = json!({
            "sessionUpdate": held.kind,
            "content": {"type": "text", "text": held.text},
        });
        if let Some(id) = held.message_id {
            update["messageId"] = json!(id);
        }
        Some(update)
    }

    pub fn is_holding(&self) -> bool {
        self.held.is_some()
    }

    pub fn due(&self, now: Instant) -> bool {
        self.held.as_ref().is_some_and(|held| {
            now.duration_since(held.first_at) >= FLUSH_AFTER || held.text.len() >= FLUSH_BYTES
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_of_one_message_join_until_another_kind_arrives() {
        let now = Instant::now();
        let mut coalescer = Coalescer::default();
        assert!(matches!(
            coalescer.push("agent_message_chunk", Some("t"), None, "a", now),
            Pushed::Held
        ));
        assert!(matches!(
            coalescer.push("agent_message_chunk", Some("t"), None, "b", now),
            Pushed::Held
        ));
        let Pushed::Flush(flushed) =
            coalescer.push("agent_thought_chunk", Some("t"), None, "x", now)
        else {
            panic!("the message text flushes before the thought");
        };
        assert_eq!(flushed["content"]["text"], "ab");
        assert_eq!(flushed["sessionUpdate"], "agent_message_chunk");
        assert_eq!(coalescer.take().unwrap()["content"]["text"], "x");
        assert!(coalescer.take().is_none());
    }

    #[test]
    fn held_text_is_due_after_100_ms_or_64_kib() {
        let now = Instant::now();
        let mut coalescer = Coalescer::default();
        coalescer.push("agent_message_chunk", None, None, "a", now);
        assert!(!coalescer.due(now));
        assert!(coalescer.due(now + Duration::from_millis(100)));
        let mut big = Coalescer::default();
        big.push(
            "agent_message_chunk",
            None,
            None,
            &"x".repeat(FLUSH_BYTES),
            now,
        );
        assert!(big.due(now));
    }

    #[test]
    fn only_plain_text_chunks_are_held() {
        let image = json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "image", "data": "x"}});
        assert!(chunk_text(&image).is_none());
        let replace = json!({"sessionUpdate": "agent_message_chunk", "replace": true, "content": {"type": "text", "text": "x"}});
        assert!(chunk_text(&replace).is_none());
        let text = json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "x"}});
        assert_eq!(chunk_text(&text), Some("x"));
    }
}
