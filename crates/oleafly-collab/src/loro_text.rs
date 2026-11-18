use loro::TextDelta;
use oleafly_ot::{ChannelError, EditorChannel, OtError, Pieces, TextOperation};

pub fn operation_for(
    channel: &EditorChannel,
    deltas: &[TextDelta],
) -> Result<TextOperation, ChannelError> {
    Ok(operation_for_pieces(channel.pieces(), deltas)?)
}

// Loro counts a change's retained and deleted spans in characters; the
// editor counts UTF-16 units.
pub fn operation_for_pieces(
    pieces: &Pieces,
    deltas: &[TextDelta],
) -> Result<TextOperation, OtError> {
    let mut walk = pieces.walk_chars();
    let mut passed = 0;
    let mut operation = TextOperation::new();
    for delta in deltas {
        match delta {
            TextDelta::Retain { retain, .. } => {
                let units = walk.units(*retain)?;
                passed += units;
                operation.retain(units);
            }
            TextDelta::Insert { insert, .. } => {
                operation.insert(insert);
            }
            TextDelta::Delete { delete } => {
                let units = walk.units(*delete)?;
                passed += units;
                operation.delete(units);
            }
        }
    }
    operation.retain(pieces.units() - passed);
    Ok(operation)
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
    fn a_loro_change_turns_into_the_same_operation_as_from_the_whole_text() {
        let mut dice = Dice(0x2545_f491_4f6c_dd1d);
        for limit in [1, 3, 7, 4096] {
            let mut plain = "ab😀cd\néf 𝄞 gh".repeat(4);
            for round in 0..300 {
                let pieces = Pieces::sized(&plain, limit);
                let deltas = dice.deltas(&plain);
                let expected = delta_to_operation(&plain, &deltas).unwrap();
                assert_eq!(
                    operation_for_pieces(&pieces, &deltas).unwrap(),
                    expected,
                    "limit {limit} round {round}"
                );
                plain = expected.apply(&plain).unwrap();
            }
        }
        let pieces = Pieces::sized("abc", 2);
        assert!(operation_for_pieces(
            &pieces,
            &[TextDelta::Retain {
                retain: 4,
                attributes: None
            }]
        )
        .is_err());
    }
}
