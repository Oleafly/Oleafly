use loro::TextDelta;

use crate::ot::{utf16_len, Component, OtError, TextOperation};

const PIECE_BYTES: usize = 4096;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Piece {
    text: String,
    chars: usize,
    units: usize,
}

impl Piece {
    fn new(text: String) -> Piece {
        let (chars, units) = text.chars().fold((0, 0), |(chars, units), character| {
            (chars + 1, units + character.len_utf16())
        });
        Piece { text, chars, units }
    }
}

fn cut(text: &str, limit: usize) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let mut at = rest.len().min(limit);
        while !rest.is_char_boundary(at) {
            at -= 1;
        }
        if at == 0 {
            at = rest.chars().next().map_or(rest.len(), char::len_utf8);
        }
        let (head, tail) = rest.split_at(at);
        pieces.push(Piece::new(head.to_owned()));
        rest = tail;
    }
    pieces
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Spot {
    piece: usize,
    byte: usize,
}

#[derive(Clone, Copy)]
enum By {
    Units,
    Chars,
}

struct Edit<'a> {
    start: Spot,
    end: Spot,
    removed: usize,
    text: &'a str,
}

#[derive(Clone, Debug)]
pub(super) struct Pieces {
    pieces: Vec<Piece>,
    units: usize,
    limit: usize,
}

impl Pieces {
    pub(super) fn new(text: &str) -> Pieces {
        Pieces::sized(text, PIECE_BYTES)
    }

    fn sized(text: &str, limit: usize) -> Pieces {
        let pieces = cut(text, limit);
        let units = pieces.iter().map(|piece| piece.units).sum();
        Pieces {
            pieces,
            units,
            limit,
        }
    }

    pub(super) fn units(&self) -> usize {
        self.units
    }

    pub(super) fn text(&self) -> String {
        self.pieces
            .iter()
            .map(|piece| piece.text.as_str())
            .collect()
    }

    pub(super) fn holds(&self, text: &str) -> bool {
        let mut rest = text;
        for piece in &self.pieces {
            match rest.strip_prefix(piece.text.as_str()) {
                Some(after) => rest = after,
                None => return false,
            }
        }
        rest.is_empty()
    }

    fn advance(&self, at: &mut Spot, count: usize, by: By) -> Result<usize, OtError> {
        let mut left = count;
        let mut passed = 0;
        while left > 0 {
            let piece = self.pieces.get(at.piece).ok_or(OtError::LengthMismatch)?;
            let whole = match by {
                By::Units => piece.units,
                By::Chars => piece.chars,
            };
            if at.byte == 0 && left >= whole {
                left -= whole;
                passed += piece.units;
                at.piece += 1;
                continue;
            }
            for (index, character) in piece.text[at.byte..].char_indices() {
                if left == 0 {
                    at.byte += index;
                    return Ok(passed);
                }
                let step = match by {
                    By::Units => character.len_utf16(),
                    By::Chars => 1,
                };
                if step > left {
                    return Err(OtError::SplitsCharacter);
                }
                left -= step;
                passed += character.len_utf16();
            }
            at.piece += 1;
            at.byte = 0;
        }
        Ok(passed)
    }

    pub(super) fn apply(&mut self, operation: &TextOperation) -> Result<(), OtError> {
        if operation.base_len() != self.units {
            return Err(OtError::LengthMismatch);
        }
        let mut edits = Vec::new();
        let mut at = Spot::default();
        for component in operation.components() {
            match component {
                Component::Retain(count) => {
                    self.advance(&mut at, *count, By::Units)?;
                }
                Component::Insert(text) => edits.push(Edit {
                    start: at,
                    end: at,
                    removed: 0,
                    text,
                }),
                Component::Delete(count) => {
                    let start = at;
                    self.advance(&mut at, *count, By::Units)?;
                    edits.push(Edit {
                        start,
                        end: at,
                        removed: *count,
                        text: "",
                    });
                }
            }
        }
        for edit in edits.into_iter().rev() {
            self.replace(edit);
        }
        self.split_large();
        Ok(())
    }

    fn replace(&mut self, edit: Edit<'_>) {
        let Edit {
            start,
            end,
            removed,
            text,
        } = edit;
        self.units = self.units - removed + utf16_len(text);
        let count = self.pieces.len();
        if start.piece == count {
            if !text.is_empty() {
                self.pieces.push(Piece::new(text.to_owned()));
            }
            return;
        }
        if start.piece == end.piece {
            let piece = &mut self.pieces[start.piece];
            let mut changed = std::mem::take(&mut piece.text);
            changed.replace_range(start.byte..end.byte, text);
            if changed.is_empty() {
                self.pieces.remove(start.piece);
            } else {
                *piece = Piece::new(changed);
            }
            return;
        }
        let (stop, tail) = match self.pieces.get(end.piece) {
            Some(last) if end.byte > 0 => (end.piece + 1, &last.text[end.byte..]),
            _ => (end.piece.min(count), ""),
        };
        let mut joined = String::with_capacity(start.byte + text.len() + tail.len());
        joined.push_str(&self.pieces[start.piece].text[..start.byte]);
        joined.push_str(text);
        joined.push_str(tail);
        let replacement = (!joined.is_empty()).then(|| Piece::new(joined));
        self.pieces.splice(start.piece..stop, replacement);
    }

    fn split_large(&mut self) {
        let limit = self.limit;
        if self
            .pieces
            .iter()
            .all(|piece| piece.text.len() <= 2 * limit)
        {
            return;
        }
        self.pieces = std::mem::take(&mut self.pieces)
            .into_iter()
            .flat_map(|piece| {
                if piece.text.len() <= 2 * limit {
                    vec![piece]
                } else {
                    cut(&piece.text, limit)
                }
            })
            .collect();
    }

    // Loro counts a change's retained and deleted spans in characters; the
    // editor counts UTF-16 units.
    pub(super) fn operation_for(&self, deltas: &[TextDelta]) -> Result<TextOperation, OtError> {
        let mut at = Spot::default();
        let mut passed = 0;
        let mut operation = TextOperation::new();
        for delta in deltas {
            match delta {
                TextDelta::Retain { retain, .. } => {
                    let units = self.advance(&mut at, *retain, By::Chars)?;
                    passed += units;
                    operation.retain(units);
                }
                TextDelta::Insert { insert, .. } => {
                    operation.insert(insert);
                }
                TextDelta::Delete { delete } => {
                    let units = self.advance(&mut at, *delete, By::Chars)?;
                    passed += units;
                    operation.delete(units);
                }
            }
        }
        operation.retain(self.units - passed);
        Ok(operation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::delta_to_operation;

    struct Dice(u64);

    impl Dice {
        fn roll(&mut self, below: usize) -> usize {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 % below.max(1) as u64) as usize
        }

        fn words(&mut self) -> String {
            const BITS: [&str; 8] = ["a", "é", "😀", "\n", "bc", "ü", "𝄞x", " "];
            (0..self.roll(6))
                .map(|_| BITS[self.roll(BITS.len())])
                .collect()
        }

        fn edit(&mut self, text: &str) -> String {
            let chars: Vec<char> = text.chars().collect();
            let from = self.roll(chars.len() + 1);
            let to = (from + self.roll(5)).min(chars.len());
            let mut changed: String = chars[..from].iter().collect();
            changed.push_str(&self.words());
            changed.extend(&chars[to..]);
            changed
        }

        fn operation(&mut self, text: &str) -> TextOperation {
            let middle = self.edit(text);
            let first = TextOperation::between(text, &middle);
            if self.roll(2) == 0 {
                return first;
            }
            let last = TextOperation::between(&middle, &self.edit(&middle));
            first.compose(&last).unwrap()
        }

        fn deltas(&mut self, text: &str) -> Vec<TextDelta> {
            let mut left = text.chars().count();
            let mut deltas = Vec::new();
            while left > 0 && self.roll(4) > 0 {
                let retain = self.roll(left + 1);
                left -= retain;
                deltas.push(TextDelta::Retain {
                    retain,
                    attributes: None,
                });
                let delete = self.roll(left.min(4) + 1);
                left -= delete;
                deltas.push(TextDelta::Delete { delete });
                deltas.push(TextDelta::Insert {
                    insert: self.words(),
                    attributes: None,
                });
            }
            deltas
        }
    }

    #[test]
    fn random_changes_leave_the_same_text_and_length_as_a_plain_string() {
        for limit in [1, 2, 3, 5, 8, 64] {
            let mut dice = Dice(0x9e37_79b9_7f4a_7c15 ^ limit as u64);
            let mut plain = "Größe 😀 line\nnext 𝄞 end".repeat(3);
            let mut pieces = Pieces::sized(&plain, limit);
            for round in 0..400 {
                let operation = dice.operation(&plain);
                plain = operation.apply(&plain).unwrap();
                pieces.apply(&operation).unwrap();
                assert_eq!(pieces.text(), plain, "limit {limit} round {round}");
                assert_eq!(pieces.units(), utf16_len(&plain));
                assert!(pieces.holds(&plain));
                assert!(pieces
                    .pieces
                    .iter()
                    .all(|piece| !piece.text.is_empty() && piece.text.len() <= 2 * limit.max(4)));
            }
        }
    }

    #[test]
    fn a_loro_change_turns_into_the_same_operation_as_from_the_whole_text() {
        let mut dice = Dice(0x2545_f491_4f6c_dd1d);
        for limit in [1, 3, 7, 4096] {
            let mut plain = "ab😀cd\néf 𝄞 gh".repeat(4);
            for round in 0..300 {
                let pieces = Pieces::sized(&plain, limit);
                let deltas = dice.deltas(&plain);
                let expected = delta_to_operation(&plain, &deltas).unwrap();
                assert_eq!(
                    pieces.operation_for(&deltas).unwrap(),
                    expected,
                    "limit {limit} round {round}"
                );
                plain = expected.apply(&plain).unwrap();
            }
        }
        let pieces = Pieces::sized("abc", 2);
        assert!(pieces
            .operation_for(&[TextDelta::Retain {
                retain: 4,
                attributes: None
            }])
            .is_err());
    }

    #[test]
    fn a_change_that_splits_a_character_changes_nothing() {
        let mut pieces = Pieces::sized("a😀b😀c", 3);
        let mut operation = TextOperation::new();
        operation
            .retain(1)
            .insert("x")
            .retain(1)
            .delete(1)
            .retain(4);
        assert_eq!(pieces.apply(&operation), Err(OtError::SplitsCharacter));
        assert_eq!(pieces.text(), "a😀b😀c");
        let mut wrong = TextOperation::new();
        wrong.retain(3);
        assert_eq!(pieces.apply(&wrong), Err(OtError::LengthMismatch));
        assert_eq!(pieces.units(), 7);
        assert!(!pieces.holds("a😀b😀"));
        assert!(!pieces.holds("a😀b😀cd"));
    }
}
