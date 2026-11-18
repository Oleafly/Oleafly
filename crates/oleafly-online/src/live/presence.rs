use oleafly_ot::utf16_len;

pub fn to_row_column(text: &str, offset: usize) -> (u64, u64) {
    let mut row = 0;
    let mut line_start = 0;
    let mut seen = 0;
    for character in text.chars() {
        if seen >= offset {
            break;
        }
        seen += character.len_utf16();
        if character == '\n' {
            row += 1;
            line_start = seen;
        }
    }
    (row, (offset.min(utf16_len(text)) - line_start) as u64)
}

pub fn to_offset(text: &str, row: u64, column: u64) -> usize {
    let mut offset = 0;
    let mut lines = text.split('\n');
    for _ in 0..row {
        match lines.next() {
            Some(line) => offset += utf16_len(line) + 1,
            None => return utf16_len(text),
        }
    }
    match lines.next() {
        Some(line) => {
            offset
                + usize::try_from(column)
                    .unwrap_or(usize::MAX)
                    .min(utf16_len(line))
        }
        None => utf16_len(text),
    }
}

#[cfg(test)]
mod tests {
    use super::{to_offset, to_row_column};
    use oleafly_ot::utf16_len;

    #[test]
    fn row_column_and_offset_round_trip_with_astral_text() {
        let text = "a😀b\n\nπ = 3.14 𝔸\nend";
        for offset in 0..=utf16_len(text) {
            let (row, column) = to_row_column(text, offset);
            assert_eq!(to_offset(text, row, column), offset, "offset {offset}");
        }
        assert_eq!(to_row_column(text, 3), (0, 3));
        assert_eq!(to_offset(text, 2, 11), 17);
    }

    #[test]
    fn a_position_past_a_line_or_the_text_clamps() {
        let text = "ab\ncd";
        assert_eq!(to_offset(text, 0, 9), 2);
        assert_eq!(to_offset(text, 1, 9), 5);
        assert_eq!(to_offset(text, 7, 0), 5);
        assert_eq!(to_offset("", 0, 4), 0);
    }
}
