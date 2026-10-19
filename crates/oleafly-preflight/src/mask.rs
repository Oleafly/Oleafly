//! LaTeX comment masking (`packages/preflight/src/mask.ts`).

use crate::text::utf16_len;

/// Replaces every `%` comment with spaces, one per UTF-16 unit, so every
/// offset after it stays where it was. A `%` preceded by an odd number of
/// backslashes is escaped and stays.
pub fn mask_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for (index, line) in text.split('\n').enumerate() {
        if index > 0 {
            out.push('\n');
        }
        out.push_str(&mask_line(line));
    }
    out
}

fn mask_line(line: &str) -> std::borrow::Cow<'_, str> {
    let bytes = line.as_bytes();
    for (at, &byte) in bytes.iter().enumerate() {
        if byte != b'%' {
            continue;
        }
        let backslashes = bytes[..at]
            .iter()
            .rev()
            .take_while(|&&b| b == b'\\')
            .count();
        if backslashes % 2 == 0 {
            let mut masked = String::with_capacity(line.len());
            masked.push_str(&line[..at]);
            masked.extend(std::iter::repeat_n(' ', utf16_len(&line[at..])));
            return masked.into();
        }
    }
    line.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_comments_but_keeps_escaped_percent_signs() {
        assert_eq!(mask_comments("a % b\nc"), "a    \nc");
        assert_eq!(mask_comments("50\\% off % note"), "50\\% off       ");
        assert_eq!(mask_comments("x\\\\% c"), "x\\\\   ");
    }

    #[test]
    fn an_emoji_in_a_comment_keeps_its_utf16_width() {
        let masked = mask_comments("a %😀");
        assert_eq!(masked, "a    ");
        assert_eq!(utf16_len(&masked), utf16_len("a %😀"));
    }
}
