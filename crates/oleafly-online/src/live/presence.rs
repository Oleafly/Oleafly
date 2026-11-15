use oleafly_ot::utf16_len;

pub fn row_column(text: &str, offset: usize) -> (u64, u64) {
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
