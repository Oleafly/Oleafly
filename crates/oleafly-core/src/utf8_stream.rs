use std::borrow::Cow;

#[derive(Default)]
pub struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub fn push(&mut self, bytes: &[u8], finish: bool) -> String {
        self.pending.extend_from_slice(bytes);
        let mut output = String::new();
        let mut consumed = 0;
        while consumed < self.pending.len() {
            match std::str::from_utf8(&self.pending[consumed..]) {
                Ok(valid) => {
                    output.push_str(valid);
                    consumed = self.pending.len();
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    output.push_str(
                        std::str::from_utf8(&self.pending[consumed..valid_end])
                            .expect("valid_up_to must identify valid UTF-8"),
                    );
                    consumed = valid_end;
                    match error.error_len() {
                        Some(invalid_len) => {
                            output.push('\u{fffd}');
                            consumed += invalid_len;
                        }
                        None if finish => {
                            output.push_str(&String::from_utf8_lossy(&self.pending[consumed..]));
                            consumed = self.pending.len();
                        }
                        None => break,
                    }
                }
            }
        }
        if consumed > 0 {
            self.pending.drain(..consumed);
        }
        output
    }
}

fn sequence_len(lead: u8) -> usize {
    match lead {
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf7 => 4,
        _ => 0,
    }
}

fn is_continuation(byte: u8) -> bool {
    byte & 0xc0 == 0x80
}

fn split_sequence_needs(bytes: &[u8], line_end: usize) -> usize {
    let trailing = bytes[..line_end]
        .iter()
        .rev()
        .take(3)
        .take_while(|byte| is_continuation(**byte))
        .count();
    let Some(lead) = line_end.checked_sub(trailing + 1).map(|index| bytes[index]) else {
        return 0;
    };
    sequence_len(lead).saturating_sub(trailing + 1)
}

pub fn rejoin_split_utf8_lines(bytes: &[u8]) -> Cow<'_, [u8]> {
    let mut output: Option<Vec<u8>> = None;
    let mut copied = 0;
    let mut index = 0;
    while let Some(offset) = bytes[index..].iter().position(|byte| *byte == b'\n') {
        let newline = index + offset;
        let line_end = if newline > 0 && bytes[newline - 1] == b'\r' {
            newline - 1
        } else {
            newline
        };
        let needed = split_sequence_needs(bytes, line_end);
        let next = newline + 1;
        let completes = needed > 0
            && bytes
                .get(next..next + needed)
                .is_some_and(|tail| tail.iter().all(|byte| is_continuation(*byte)));
        if completes {
            let joined = output.get_or_insert_with(|| Vec::with_capacity(bytes.len()));
            joined.extend_from_slice(&bytes[copied..line_end]);
            copied = next;
        }
        index = next;
    }
    match output {
        Some(mut joined) => {
            joined.extend_from_slice(&bytes[copied..]);
            Cow::Owned(joined)
        }
        None => Cow::Borrowed(bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_preserves_codepoints_split_across_chunks() {
        let mut decoder = Utf8StreamDecoder::default();
        assert_eq!(decoder.push(b"prefix \xf0\x9f", false), "prefix ");
        assert_eq!(decoder.push(b"\x98\x80 suffix", false), "😀 suffix");
        assert_eq!(decoder.push(&[], true), "");

        let mut truncated = Utf8StreamDecoder::default();
        assert_eq!(truncated.push(b"bad \xe2\x82", false), "bad ");
        assert_eq!(truncated.push(&[], true), "\u{fffd}");
    }

    #[test]
    fn rejoins_a_character_that_tex_split_with_a_line_break() {
        let czech = "LaTeX Warning: Reference `\u{17e}\u{17e}' on page 1 undefined";
        let bytes = czech.as_bytes();
        let cut = bytes.len() - "' on page 1 undefined".len() - 1;
        for newline in [&b"\n"[..], &b"\r\n"[..]] {
            let mut wrapped = bytes[..cut].to_vec();
            wrapped.extend_from_slice(newline);
            wrapped.extend_from_slice(&bytes[cut..]);
            let joined = rejoin_split_utf8_lines(&wrapped);
            assert_eq!(std::str::from_utf8(&joined).unwrap(), czech);
        }
        let cjk = "\u{56fe}\u{8868}".as_bytes();
        let wrapped = [&cjk[..4], b"\n", &cjk[4..]].concat();
        assert_eq!(
            std::str::from_utf8(&rejoin_split_utf8_lines(&wrapped)).unwrap(),
            "\u{56fe}\u{8868}"
        );
    }

    #[test]
    fn leaves_whole_lines_and_invalid_bytes_alone() {
        let text = "\u{17e}\n\u{17e}\n".as_bytes();
        assert!(matches!(rejoin_split_utf8_lines(text), Cow::Borrowed(_)));
        let invalid = b"bad \xc5\nplain";
        assert_eq!(&*rejoin_split_utf8_lines(invalid), &invalid[..]);
    }
}
