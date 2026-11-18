//! Command lines the way the Microsoft C runtime splits them, and `cmd.exe`
//! lines, built in UTF-16 so no character is lost.
use crate::SandboxError;

/// The longest command `cmd.exe` takes.
pub const MAX_CMD_UNITS: usize = 8_000;

pub const CMD_SWITCHES: [&str; 3] = ["/D", "/S", "/C"];

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

pub fn command_line(program: &[u16], args: &[Vec<u16>]) -> Vec<u16> {
    let mut line = Vec::new();
    quote_arg(program, &mut line);
    for arg in args {
        line.push(b' ' as u16);
        quote_arg(arg, &mut line);
    }
    line
}

pub fn cmd_tail(text: &str) -> Result<String, SandboxError> {
    if text.contains('\0') {
        return Err(SandboxError::Invalid(
            "A command cannot contain NUL characters.".into(),
        ));
    }
    if text.encode_utf16().count() > MAX_CMD_UNITS {
        return Err(SandboxError::Invalid(
            "Windows commands are limited to 8,000 characters. Put a long command in a script file.".into(),
        ));
    }
    Ok(format!("\"{text}\""))
}

/// `cmd.exe /D /S /C "<text>"`: with `/S`, cmd.exe removes the outer quotes
/// and runs the text as written.
pub fn cmd_line(text: &str) -> Result<Vec<u16>, SandboxError> {
    let tail = cmd_tail(text)?;
    Ok(format!("cmd.exe {} {tail}", CMD_SWITCHES.join(" "))
        .encode_utf16()
        .collect())
}

pub fn quoted_cmd_words<S: AsRef<str>>(words: &[S]) -> Result<String, &str> {
    let refused = |word: &&str| {
        word.is_empty() || word.ends_with('\\') || word.contains(['"', '%', '\n', '\r'])
    };
    if let Some(word) = words.iter().map(AsRef::as_ref).find(refused) {
        return Err(word);
    }
    let quoted: Vec<String> = words
        .iter()
        .map(|word| format!("\"{}\"", word.as_ref()))
        .collect();
    Ok(format!("\"{}\"", quoted.join(" ")))
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
        let line = cmd_line("echo hi").unwrap();
        assert_eq!(
            String::from_utf16(&line).unwrap(),
            "cmd.exe /D /S /C \"echo hi\""
        );
        assert_eq!(
            cmd_tail(r#"git commit -m "fix bug" & echo "a b""#).unwrap(),
            r#""git commit -m "fix bug" & echo "a b"""#
        );
        assert!(cmd_line("a\0").is_err());
        assert!(cmd_tail(&"ü".repeat(8_000)).is_ok());
        for long in ["a".repeat(8_001), "😀".repeat(4_001)] {
            assert!(cmd_tail(&long)
                .unwrap_err()
                .to_string()
                .contains("8,000 characters"));
        }
    }

    #[test]
    fn quoted_cmd_words_refuse_what_cmd_or_the_c_runtime_would_change() {
        assert_eq!(
            quoted_cmd_words(&[r"C:\Program Files\agent.cmd", "login", "a&b"]).unwrap(),
            r#"""C:\Program Files\agent.cmd" "login" "a&b"""#
        );
        for risky in [
            "",
            "100%",
            "say \"hi\"",
            "two\nlines",
            "two\rlines",
            r"C:\Users\me\",
            "\\",
        ] {
            assert_eq!(
                quoted_cmd_words(&["agent", risky]),
                Err(risky),
                "accepted {risky:?}"
            );
        }
    }
}
