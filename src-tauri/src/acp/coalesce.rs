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
    carry: usize,
}

#[derive(Default)]
pub(super) struct Coalescer {
    held: Option<Held>,
}

pub(super) enum Pushed {
    Held,
    Flush(Value),
}

pub(super) fn chunk_text(update: &Value) -> Option<&str> {
    if update["replace"].as_bool() == Some(true) || update["content"]["type"] != "text" {
        return None;
    }
    update["content"]["text"].as_str()
}

impl Coalescer {
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
            carry: 0,
        });
        match previous {
            Some(previous) => Pushed::Flush(previous),
            None => Pushed::Held,
        }
    }

    pub fn take(&mut self) -> Option<Value> {
        let held = self.held.take()?;
        Some(chunk_update(
            &held.kind,
            held.message_id.as_deref(),
            held.text,
        ))
    }

    pub fn take_due(
        &mut self,
        holdback: impl Fn(&str) -> usize,
        redact: impl Fn(&str) -> String,
        now: Instant,
    ) -> Option<Value> {
        let held = self.held.as_mut()?;
        held.text = redact(&held.text);
        let keep = holdback(&held.text);
        if keep == 0 {
            return self.take();
        }
        if held.text.len() <= keep {
            held.carry = held.text.len();
            return None;
        }
        let mut split = held.text.len() - keep;
        while !held.text.is_char_boundary(split) {
            split -= 1;
        }
        if split == 0 {
            held.carry = held.text.len();
            return None;
        }
        let rest = held.text.split_off(split);
        let text = std::mem::replace(&mut held.text, rest);
        held.carry = held.text.len();
        held.first_at = now;
        Some(chunk_update(&held.kind, held.message_id.as_deref(), text))
    }

    pub fn is_holding(&self) -> bool {
        self.held.is_some()
    }

    pub fn only_carry(&self) -> bool {
        self.held
            .as_ref()
            .is_some_and(|held| held.text.len() <= held.carry)
    }

    pub fn due(&self, now: Instant) -> bool {
        self.held.as_ref().is_some_and(|held| {
            held.text.len() > held.carry
                && (now.duration_since(held.first_at) >= FLUSH_AFTER
                    || held.text.len() >= FLUSH_BYTES)
        })
    }
}

fn chunk_update(kind: &str, message_id: Option<&str>, text: String) -> Value {
    let mut update = json!({
        "sessionUpdate": kind,
        "content": {"type": "text", "text": text},
    });
    if let Some(id) = message_id {
        update["messageId"] = json!(id);
    }
    update
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
    fn a_secret_streamed_across_due_flushes_is_never_split_between_events() {
        let secret = "tok-0123456789abcdef0123456789abcdef";
        let redact = |text: &str| text.replace(secret, "[credential omitted]");
        let holdback = |text: &str| overlap(text, secret);
        let start = Instant::now();
        let mut coalescer = Coalescer::default();
        let mut stored = Vec::new();
        let pieces = [
            "Your key is tok-0123",
            "456789abcdef01",
            "23456789abcdef and more",
        ];
        for (index, piece) in pieces.iter().enumerate() {
            coalescer.push("agent_message_chunk", Some("t"), None, piece, start);
            let later = start + FLUSH_AFTER * (index as u32 + 1);
            if coalescer.due(later) {
                if let Some(update) = coalescer.take_due(holdback, redact, later) {
                    stored.push(update["content"]["text"].as_str().unwrap().to_owned());
                }
            }
        }
        if let Some(update) = coalescer.take() {
            stored.push(update["content"]["text"].as_str().unwrap().to_owned());
        }
        let redacted: Vec<String> = stored.iter().map(|text| redact(text)).collect();
        let joined: String = redacted.concat();
        assert!(!joined.contains("0123456789"), "{redacted:?}");
        assert_eq!(joined, "Your key is [credential omitted] and more");
    }

    fn overlap(text: &str, secret: &str) -> usize {
        (1..secret.len().min(text.len() + 1))
            .rev()
            .find(|&len| {
                secret
                    .as_bytes()
                    .starts_with(&text.as_bytes()[text.len() - len..])
            })
            .unwrap_or(0)
    }

    #[test]
    fn a_due_flush_stores_prose_whole_however_long_the_known_secrets_are() {
        // A short message followed by a long wait (a tool call, an agent
        // waiting to be stopped) stayed unstored, and unseen, until the
        // message ended when the whole of it was held back as a possible
        // secret: CI runners carry 40-character tokens in the environment.
        let now = Instant::now();
        let secret = "ghs_0123456789abcdef0123456789abcdef0123";
        let mut coalescer = Coalescer::default();
        coalescer.push(
            "agent_message_chunk",
            Some("t"),
            None,
            "ACP fixture waiting for cancellation.",
            now,
        );
        let update = coalescer
            .take_due(
                |text| overlap(text, secret),
                str::to_owned,
                now + FLUSH_AFTER,
            )
            .unwrap();
        assert_eq!(
            update["content"]["text"],
            "ACP fixture waiting for cancellation."
        );
        assert!(!coalescer.is_holding());
    }

    #[test]
    fn without_secrets_a_due_flush_stores_all_the_held_text() {
        let now = Instant::now();
        let mut coalescer = Coalescer::default();
        coalescer.push("agent_message_chunk", None, Some("m"), "all of it", now);
        let update = coalescer
            .take_due(|_| 0, str::to_owned, now + FLUSH_AFTER)
            .unwrap();
        assert_eq!(update["content"]["text"], "all of it");
        assert_eq!(update["messageId"], "m");
        assert!(!coalescer.is_holding());
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
