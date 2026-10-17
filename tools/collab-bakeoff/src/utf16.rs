pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

pub fn snap_back(text: &str, pos: usize) -> usize {
    let mut offset = 0;
    for character in text.chars() {
        let next = offset + character.len_utf16();
        if next > pos {
            return offset;
        }
        offset = next;
    }
    offset
}

pub fn is_boundary(text: &str, pos: usize) -> bool {
    snap_back(text, pos) == pos
}
