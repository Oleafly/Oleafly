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
    fn writes_lowercase_hex() {
        assert_eq!(hex_lower(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
        assert_eq!(hex_lower(&[]), "");
    }
}
