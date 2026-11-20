//! Command lines the way the Microsoft C runtime splits them, and `cmd.exe`
//! lines, built in UTF-16 so no character is lost.
use crate::SandboxError;
use std::ffi::OsStr;
use std::path::Path;

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

pub fn wrapper_safe_arg(arg: &str) -> Option<String> {
    const RESPELLED_BARE: [char; 7] = ['\'', '[', ']', '{', '}', '*', '?'];
    let needs_quotes =
        arg.contains(RESPELLED_BARE) && !arg.contains(['"', ' ', '\t', '\n', '\r', '\0']);
    needs_quotes.then(|| {
        let trailing = arg.len() - arg.trim_end_matches('\\').len();
        format!("\"{arg}{}\"", "\\".repeat(trailing))
    })
}

pub fn is_windows_batch_script(program: &Path) -> bool {
    program
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("bat") || extension.eq_ignore_ascii_case("cmd")
        })
}

pub fn add_wrapper_safe_args<S: AsRef<OsStr>>(
    command: &mut std::process::Command,
    program: &Path,
    args: &[S],
) {
    let quote = cfg!(windows) && !is_windows_batch_script(program);
    for arg in args {
        let arg = arg.as_ref();
        match arg.to_str().and_then(wrapper_safe_arg).filter(|_| quote) {
            Some(quoted) => push_raw_arg(command, quoted),
            None => {
                command.arg(arg);
            }
        }
    }
}

#[cfg(windows)]
fn push_raw_arg(command: &mut std::process::Command, text: String) {
    use std::os::windows::process::CommandExt;
    command.raw_arg(text);
}

#[cfg(not(windows))]
fn push_raw_arg(command: &mut std::process::Command, text: String) {
    command.arg(text);
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

    #[test]
    fn a_bare_argument_a_script_wrapper_would_respell_is_quoted_on_windows() {
        for (arg, quoted) in [
            (
                "-outdir=C:/Users/O'Brien/build",
                "\"-outdir=C:/Users/O'Brien/build\"",
            ),
            ("./fig[1].tex", "\"./fig[1].tex\""),
            ("-r", ""),
            ("./main.tex", ""),
            ("C:/a b/O'Brien.tex", ""),
            ("say\"what'", ""),
            ("C:\\it's\\", "\"C:\\it's\\\\\""),
        ] {
            assert_eq!(wrapper_safe_arg(arg).unwrap_or_default(), quoted, "{arg}");
        }
        assert!(is_windows_batch_script(Path::new("C:/tl/bin/tlmgr.BAT")));
        assert!(is_windows_batch_script(Path::new("quarto.cmd")));
        assert!(!is_windows_batch_script(Path::new("C:/tl/bin/latexmk.exe")));
    }

    #[test]
    fn wrapper_safe_args_keep_every_argument_in_order() {
        let mut command = std::process::Command::new("latexmk");
        add_wrapper_safe_args(
            &mut command,
            Path::new("latexmk"),
            &["-norc", "./O'Neil.tex", "a b"],
        );
        let args: Vec<_> = command.get_args().collect();
        if cfg!(windows) {
            assert_eq!(args, ["-norc", "\"./O'Neil.tex\"", "a b"]);
        } else {
            assert_eq!(args, ["-norc", "./O'Neil.tex", "a b"]);
        }
    }
}
