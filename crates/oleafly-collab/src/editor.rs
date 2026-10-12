use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use crate::ot::{utf16_len, OtError, TextOperation};

pub const HISTORY_LIMIT: usize = 500;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocMessage {
    Ack {
        rev: u64,
        length: usize,
    },
    Remote {
        rev: u64,
        op: TextOperation,
        length: usize,
    },
    Reset {
        rev: u64,
        text: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ChannelError {
    #[error("the editor is too far behind and must reload the file")]
    Stale,
    #[error("the editor sent a change that does not fit: {0}")]
    Invalid(OtError),
}

impl From<OtError> for ChannelError {
    fn from(error: OtError) -> ChannelError {
        ChannelError::Invalid(error)
    }
}

pub struct EditorChannel {
    text: String,
    rev: u64,
    first_rev: u64,
    history: VecDeque<TextOperation>,
}

impl EditorChannel {
    pub fn new(text: String) -> EditorChannel {
        EditorChannel {
            text,
            rev: 0,
            first_rev: 0,
            history: VecDeque::new(),
        }
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn rev(&self) -> u64 {
        self.rev
    }

    pub fn length(&self) -> usize {
        utf16_len(&self.text)
    }

    fn record(&mut self, operation: TextOperation) {
        self.history.push_back(operation);
        self.rev += 1;
        while self.history.len() > HISTORY_LIMIT {
            self.history.pop_front();
            self.first_rev += 1;
        }
    }

    pub fn receive(
        &mut self,
        base_rev: u64,
        operation: TextOperation,
    ) -> Result<TextOperation, ChannelError> {
        if base_rev > self.rev {
            return Err(ChannelError::Invalid(OtError::Incompatible));
        }
        if base_rev < self.first_rev {
            return Err(ChannelError::Stale);
        }
        let skip = (base_rev - self.first_rev) as usize;
        let mut transformed = operation;
        for concurrent in self.history.iter().skip(skip) {
            transformed = TextOperation::transform(&transformed, concurrent)?.0;
        }
        self.text = transformed.apply(&self.text)?;
        self.record(transformed.clone());
        Ok(transformed)
    }

    pub fn remote(&mut self, operation: TextOperation) -> Result<(), ChannelError> {
        self.text = operation.apply(&self.text)?;
        self.record(operation);
        Ok(())
    }

    pub fn reset(&mut self, text: String) -> u64 {
        self.text = text;
        self.rev += 1;
        self.first_rev = self.rev;
        self.history.clear();
        self.rev
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_at(position: usize, text: &str, length: usize) -> TextOperation {
        let mut operation = TextOperation::new();
        operation
            .retain(position)
            .insert(text)
            .retain(length - position);
        operation
    }

    #[test]
    fn a_late_editor_change_is_moved_past_remote_changes() {
        let mut channel = EditorChannel::new("abc".to_owned());
        channel.remote(insert_at(0, "XY", 3)).unwrap();
        assert_eq!(channel.text(), "XYabc");
        let applied = channel.receive(0, insert_at(3, "!", 3)).unwrap();
        assert_eq!(channel.text(), "XYabc!");
        assert_eq!(applied, insert_at(5, "!", 5));
        assert_eq!(channel.rev(), 2);
    }

    #[test]
    fn a_change_from_the_future_or_too_old_is_refused() {
        let mut channel = EditorChannel::new("abc".to_owned());
        assert!(matches!(
            channel.receive(3, insert_at(0, "x", 3)),
            Err(ChannelError::Invalid(_))
        ));
        for _ in 0..=HISTORY_LIMIT {
            let length = channel.length();
            channel.remote(insert_at(0, "x", length)).unwrap();
        }
        assert_eq!(
            channel.receive(0, insert_at(0, "y", 3)),
            Err(ChannelError::Stale)
        );
        let rev = channel.reset("fresh".to_owned());
        assert_eq!(channel.text(), "fresh");
        let applied = channel.receive(rev, insert_at(5, "!", 5)).unwrap();
        assert_eq!(applied, insert_at(5, "!", 5));
    }

    #[test]
    fn messages_have_a_kind_tag() {
        let json = serde_json::to_value(DocMessage::Ack { rev: 3, length: 9 }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "ack", "rev": 3, "length": 9 })
        );
        let remote = serde_json::to_value(DocMessage::Remote {
            rev: 4,
            op: insert_at(0, "a", 1),
            length: 2,
        })
        .unwrap();
        assert_eq!(
            remote,
            serde_json::json!({ "kind": "remote", "rev": 4, "op": ["a", 1], "length": 2 })
        );
    }
}
