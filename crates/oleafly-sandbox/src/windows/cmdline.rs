//! Command lines the way the Microsoft C runtime splits them, and `cmd.exe`
//! lines, built in UTF-16 so no character is lost.
use crate::SandboxError;

/// The longest command `cmd.exe` takes.
pub const MAX_CMD_UNITS: usize = 8_000;

const QUOTE: u16 = b'"' as u16;
const BACKSLASH: u16 = b'\\' as u16;

fn needs_quotes(arg: &[u16]) -> bool {
    arg.is_empty()
        || arg.iter().any(|&unit| {
            unit == b' ' as u16
                || unit == b'\t' as u16
                || unit == b'\n' as u16
                || unit == 0x0B
                || unit == QUOTE
        })
}

/// Appends `arg` to `out`, quoted when needed. Backslashes are literal unless
/// they come before a quote, where they are doubled; quotes are escaped.
pub fn quote_arg(arg: &[u16], out: &mut Vec<u16>) {
    if !needs_quotes(arg) {
        out.extend_from_slice(arg);
        return;
    }
    out.push(QUOTE);
    let mut backslashes = 0usize;
    for &unit in arg {
        if unit == BACKSLASH {
            backslashes += 1;
            continue;
        }
        if unit == QUOTE {
            out.extend(std::iter::repeat_n(BACKSLASH, backslashes * 2 + 1));
        } else {
            out.extend(std::iter::repeat_n(BACKSLASH, backslashes));
        }
        out.push(unit);
        backslashes = 0;
    }
    out.extend(std::iter::repeat_n(BACKSLASH, backslashes * 2));
    out.push(QUOTE);
}

/// `program arg1 arg2 …` with each part quoted as needed.
pub fn command_line(program: &[u16], args: &[Vec<u16>]) -> Vec<u16> {
    let mut line = Vec::new();
    quote_arg(program, &mut line);
    for arg in args {
        line.push(b' ' as u16);
        quote_arg(arg, &mut line);
    }
    line
}

/// `cmd.exe /D /S /C "<text>"`: with `/S`, cmd.exe removes the outer quotes
/// and runs the text as written.
pub fn cmd_line(text: &[u16]) -> Result<Vec<u16>, SandboxError> {
    if text.contains(&0) {
        return Err(SandboxError::Invalid(
            "A command cannot contain NUL characters.".into(),
        ));
    }
    if text.len() > MAX_CMD_UNITS {
        return Err(SandboxError::Invalid(
            "Windows commands are limited to 8,000 characters. Put a long command in a script file.".into(),
        ));
    }
    let mut line: Vec<u16> = "cmd.exe /D /S /C \"".encode_utf16().collect();
    line.extend_from_slice(text);
    line.push(QUOTE);
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quoted(text: &str) -> String {
        let mut out = Vec::new();
        quote_arg(&text.encode_utf16().collect::<Vec<_>>(), &mut out);
        String::from_utf16(&out).unwrap()
    }

    #[test]
    fn msvc_quoting_table() {
        for (input, expected) in [
            ("a", "a"),
            ("a b", "\"a b\""),
            ("", "\"\""),
            ("a\"b", "\"a\\\"b\""),
            ("a\\", "a\\"),
            ("a b\\", "\"a b\\\\\""),
            ("a\\\"b", "\"a\\\\\\\"b\""),
            ("ü ß", "\"ü ß\""),
            ("x\ty", "\"x\ty\""),
        ] {
            assert_eq!(quoted(input), expected, "input {input:?}");
        }
    }

    #[test]
    fn cmd_line_wraps_text_and_rejects_nul_and_overlong() {
        let line = cmd_line(&"echo hi".encode_utf16().collect::<Vec<_>>()).unwrap();
        assert_eq!(
            String::from_utf16(&line).unwrap(),
            "cmd.exe /D /S /C \"echo hi\""
        );
        assert!(cmd_line(&[b'a' as u16, 0]).is_err());
        let long = vec![b'a' as u16; 8_001];
        assert!(cmd_line(&long)
            .unwrap_err()
            .to_string()
            .contains("8,000 characters"));
    }
}
