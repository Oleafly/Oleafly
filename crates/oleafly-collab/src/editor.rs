use std::collections::VecDeque;

use loro::TextDelta;
use serde::{Deserialize, Serialize};

use crate::ot::{OtError, TextOperation};

mod pieces;

use pieces::Pieces;

pub const HISTORY_LIMIT: usize = 5_000;

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
    text: Pieces,
    rev: u64,
    first_rev: u64,
    history: VecDeque<TextOperation>,
}

impl EditorChannel {
    pub fn new(text: String) -> EditorChannel {
        EditorChannel::starting_at(text, 0)
    }

    pub fn starting_at(text: String, rev: u64) -> EditorChannel {
        EditorChannel {
            text: Pieces::new(&text),
            rev,
            first_rev: rev,
            history: VecDeque::new(),
        }
    }

    pub fn text(&self) -> String {
        self.text.text()
    }

    pub fn holds(&self, text: &str) -> bool {
        self.text.holds(text)
    }

    pub fn rev(&self) -> u64 {
        self.rev
    }

    pub fn length(&self) -> usize {
        self.text.units()
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
        self.text.apply(&transformed)?;
        self.record(transformed.clone());
        Ok(transformed)
    }

    pub fn remote(&mut self, operation: TextOperation) -> Result<(), ChannelError> {
        self.text.apply(&operation)?;
        self.record(operation);
        Ok(())
    }

    pub fn operation_for(&self, deltas: &[TextDelta]) -> Result<TextOperation, ChannelError> {
        Ok(self.text.operation_for(deltas)?)
    }

    pub fn reset(&mut self, text: String) -> u64 {
        self.text = Pieces::new(&text);
        self.rev += 1;
        self.first_rev = self.rev;
        self.history.clear();
        self.rev
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ot::utf16_len;

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
    fn the_length_matches_the_text_after_editor_and_remote_changes() {
        let line = "@article{Größe2024, title = {Café 😀}},\n";
        let mut channel = EditorChannel::new(line.repeat(400));
        let mut plain = channel.text();
        let mut seed: u64 = 0x5851_f42d_4c95_7f2d;
        let mut roll = |below: usize| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % below as u64) as usize
        };
        for round in 0..300 {
            let lines = plain.matches('\n').count();
            let target = roll(lines + 1);
            let at = plain
                .match_indices('\n')
                .nth(target)
                .map_or(plain.len(), |(index, _)| index);
            let mut changed = plain.clone();
            if roll(3) == 0 {
                let start = plain[..at].rfind('\n').map_or(0, |index| index + 1);
                changed.replace_range(start..at, "");
            } else {
                changed.insert_str(at, ["x", "é", "😀 "][roll(3)]);
            }
            let operation = TextOperation::between(&plain, &changed);
            if roll(2) == 0 {
                channel.remote(operation).unwrap();
            } else {
                channel.receive(channel.rev(), operation).unwrap();
            }
            plain = changed;
            assert_eq!(channel.length(), utf16_len(&plain), "round {round}");
            assert!(channel.holds(&plain), "round {round}");
        }
        assert_eq!(channel.text(), plain);
    }

    // The median of many keystrokes, with plenty of room for a debug build
    // on a busy CI runner: walking or copying the whole file, as the
    // channel used to, takes about 200 ms per keystroke in a debug build,
    // and a piece takes well under a millisecond.
    #[test]
    fn a_keystroke_in_a_five_megabyte_file_does_not_walk_the_whole_file() {
        let line = "@book{Müller1999, author = {Jürgen Müller}, year = {1999}},\n";
        let text = line.repeat(5 * 1024 * 1024 / line.len());
        let length = utf16_len(&text);
        let mut channel = EditorChannel::new(text);
        let mut times: Vec<std::time::Duration> = (0..201)
            .map(|typed| {
                let started = std::time::Instant::now();
                channel
                    .receive(
                        channel.rev(),
                        insert_at(length - 10 + typed, "x", length + typed),
                    )
                    .unwrap();
                assert_eq!(channel.length(), length + typed + 1);
                started.elapsed()
            })
            .collect();
        times.sort();
        assert!(
            times[100] < std::time::Duration::from_millis(10),
            "{:?}",
            times[100]
        );
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
