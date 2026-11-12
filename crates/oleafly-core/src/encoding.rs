fn hex_value(byte: u8) -> Option<u8> {
    (byte as char).to_digit(16).map(|digit| digit as u8)
}

fn decode(text: &str, plus_is_space: bool) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'+' && plus_is_space {
            out.push(b' ');
            index += 1;
            continue;
        }
        if byte == b'%' {
            let high = bytes.get(index + 1).copied().and_then(hex_value);
            let low = bytes.get(index + 2).copied().and_then(hex_value);
            if let (Some(high), Some(low)) = (high, low) {
                out.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        out.push(byte);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn percent_decode(text: &str) -> String {
    decode(text, false)
}

pub fn form_decode(text: &str) -> String {
    decode(text, true)
}

pub fn decode_text(bytes: Vec<u8>) -> Option<String> {
    let unit: fn([u8; 2]) -> u16 = match bytes.get(..2) {
        Some([0xff, 0xfe]) => u16::from_le_bytes,
        Some([0xfe, 0xff]) => u16::from_be_bytes,
        _ => return String::from_utf8(bytes).ok(),
    };
    let body = &bytes[2..];
    if !body.len().is_multiple_of(2) {
        return None;
    }
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|pair| unit([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

pub fn truncate_utf8(text: &str, limit: usize) -> &str {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

pub fn hex_lower(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes_and_keeps_broken_ones() {
        assert_eq!(percent_decode("Fig%201%2Epng"), "Fig 1.png");
        assert_eq!(percent_decode("caf%C3%A9+x"), "café+x");
        assert_eq!(percent_decode("100% %zz %4"), "100% %zz %4");
        assert_eq!(percent_decode("%41"), "A");
        assert_eq!(percent_decode("%ff"), "\u{fffd}");
        assert_eq!(form_decode("a+b%2Bc"), "a b+c");
    }

    #[test]
    fn decodes_utf8_and_utf16_with_a_byte_order_mark() {
        let little: Vec<u8> = [0xff, 0xfe]
            .into_iter()
            .chain("Ü\u{1F600}".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        let big: Vec<u8> = [0xfe, 0xff]
            .into_iter()
            .chain("Ü".encode_utf16().flat_map(u16::to_be_bytes))
            .collect();
        assert_eq!(decode_text(little).as_deref(), Some("Ü\u{1F600}"));
        assert_eq!(decode_text(big).as_deref(), Some("Ü"));
        assert_eq!(decode_text("plain é".into()).as_deref(), Some("plain é"));
        assert_eq!(decode_text(vec![0xff, 0xfe, 0x00]), None);
        assert_eq!(decode_text(vec![0xff, 0xfe, 0x00, 0xd8]), None);
        assert_eq!(decode_text(vec![0xc3]), None);
    }

    #[test]
    fn truncates_on_a_character_boundary() {
        assert_eq!(truncate_utf8("héllo", 2), "h");
        assert_eq!(truncate_utf8("héllo", 3), "hé");
        assert_eq!(truncate_utf8("ab", 10), "ab");
        assert_eq!(truncate_utf8("日本", 4), "日");
    }

    #[test]
    fn writes_lowercase_hex() {
        assert_eq!(hex_lower(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
        assert_eq!(hex_lower(&[]), "");
    }
}
