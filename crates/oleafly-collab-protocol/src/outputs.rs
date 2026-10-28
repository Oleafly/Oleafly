use serde::{Deserialize, Serialize};

use crate::ids::AccountId;

pub const MAIN_FILE_HEADER: &str = "x-oleafly-main-file";
pub const MAX_MAIN_FILE_CHARS: usize = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputKind {
    Pdf,
    Synctex,
    #[serde(other)]
    Unknown,
}

impl OutputKind {
    pub const KNOWN: [OutputKind; 2] = [OutputKind::Pdf, OutputKind::Synctex];

    pub fn as_str(self) -> &'static str {
        match self {
            OutputKind::Pdf => "pdf",
            OutputKind::Synctex => "synctex",
            OutputKind::Unknown => "unknown",
        }
    }

    pub fn parse(text: &str) -> Option<OutputKind> {
        OutputKind::KNOWN
            .into_iter()
            .find(|kind| kind.as_str() == text)
    }

    pub fn content_type(self) -> &'static str {
        match self {
            OutputKind::Pdf => "application/pdf",
            OutputKind::Synctex => "application/gzip",
            OutputKind::Unknown => "application/octet-stream",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectOutput {
    pub kind: OutputKind,
    pub size: u64,
    pub compiled_by: AccountId,
    pub compiled_at: i64,
    pub main_file: String,
}

pub fn encode_main_file(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub fn decode_main_file(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let pair = value.get(at + 1..at + 3)?;
            if !pair.bytes().all(|digit| digit.is_ascii_hexdigit()) {
                return None;
            }
            decoded.push(u8::from_str_radix(pair, 16).ok()?);
            at += 3;
        } else {
            decoded.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn kinds_have_stable_wire_names_and_unknown_ones_still_read() {
        assert_eq!(serde_json::to_value(OutputKind::Pdf).unwrap(), json!("pdf"));
        assert_eq!(
            serde_json::to_value(OutputKind::Synctex).unwrap(),
            json!("synctex")
        );
        assert_eq!(
            serde_json::from_value::<OutputKind>(json!("html")).unwrap(),
            OutputKind::Unknown
        );
        assert_eq!(OutputKind::parse("pdf"), Some(OutputKind::Pdf));
        assert_eq!(OutputKind::parse("synctex"), Some(OutputKind::Synctex));
        assert_eq!(OutputKind::parse("unknown"), None);
        assert_eq!(OutputKind::parse("PDF"), None);
    }

    #[test]
    fn an_output_reads_back_from_its_snake_case_json() {
        let output = ProjectOutput {
            kind: OutputKind::Pdf,
            size: 42,
            compiled_by: "01920000-0000-7000-8000-000000000002".parse().unwrap(),
            compiled_at: 1_760_000_000_000,
            main_file: "thesis/main.tex".to_owned(),
        };
        let wire = serde_json::to_value(&output).unwrap();
        assert_eq!(
            wire,
            json!({
                "kind": "pdf",
                "size": 42,
                "compiled_by": "01920000-0000-7000-8000-000000000002",
                "compiled_at": 1_760_000_000_000_i64,
                "main_file": "thesis/main.tex",
            })
        );
        assert_eq!(
            serde_json::from_value::<ProjectOutput>(wire).unwrap(),
            output
        );
    }

    #[test]
    fn a_main_file_survives_the_header_with_any_characters() {
        for path in [
            "main.tex",
            "chapters/one two.tex",
            "论文/主文件.typ",
            "a+b%c&d=e.md",
        ] {
            let encoded = encode_main_file(path);
            assert!(
                encoded.bytes().all(|byte| byte.is_ascii_graphic()),
                "{encoded}"
            );
            assert_eq!(decode_main_file(&encoded).as_deref(), Some(path));
        }
        assert_eq!(encode_main_file("one two.tex"), "one%20two.tex");
        assert_eq!(decode_main_file("plain.tex").as_deref(), Some("plain.tex"));
    }

    #[test]
    fn a_broken_escape_is_refused() {
        assert_eq!(decode_main_file("bad%2"), None);
        assert_eq!(decode_main_file("bad%zz.tex"), None);
        assert_eq!(decode_main_file("bad%+f.tex"), None);
        assert_eq!(decode_main_file("%FF%FE"), None);
    }
}
