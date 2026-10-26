//! The agent's process tree and its stderr tail. Containment comes from the
//! sandbox crate, so the app, the CLI and the daemon kill agent trees the
//! same way.
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub use oleafly_sandbox::process::{contain_process_tree, isolate_process_tree, ProcessTreeGuard};

use crate::limits::MAX_STDERR_TAIL;

const MAX_TAIL_LINES: usize = 20;
const MAX_TAIL_CHARS: usize = 1000;

/// The last bytes an agent wrote to stderr, for error messages.
#[derive(Clone, Default)]
pub(crate) struct StderrTail(Arc<Mutex<VecDeque<u8>>>);

impl StderrTail {
    pub(crate) fn push(&self, bytes: &[u8]) {
        if let Ok(mut tail) = self.0.lock() {
            tail.extend(bytes);
            while tail.len() > MAX_STDERR_TAIL {
                tail.pop_front();
            }
        }
    }

    /// The last 20 non-empty lines joined by spaces, without control
    /// characters: their last 1,000 characters, so the final error line is
    /// always there.
    pub(crate) fn text(&self) -> String {
        let bytes: Vec<u8> = self
            .0
            .lock()
            .map(|value| value.iter().copied().collect())
            .unwrap_or_default();
        let text = decode_output(&bytes, output_code_page());
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !is_runtime_warning(line))
            .collect();
        let joined: Vec<char> = lines[lines.len().saturating_sub(MAX_TAIL_LINES)..]
            .join(" ")
            .chars()
            .filter(|value| !value.is_control() && *value != '\u{fffd}')
            .collect();
        joined[joined.len().saturating_sub(MAX_TAIL_CHARS)..]
            .iter()
            .collect::<String>()
            .trim()
            .to_owned()
    }
}

pub(crate) fn decode_output(bytes: &[u8], code_page: Option<u32>) -> String {
    bytes
        .split(|byte| *byte == b'\n')
        .map(|line| decode_line(line, code_page))
        .collect::<Vec<_>>()
        .join("\n")
}

fn decode_line(line: &[u8], code_page: Option<u32>) -> String {
    if let Ok(text) = std::str::from_utf8(line) {
        return text.to_owned();
    }
    if let Some(encoding) = code_page.and_then(code_page_encoding) {
        let (text, _, had_errors) = encoding.decode(line);
        if !had_errors {
            return text.into_owned();
        }
    }
    String::from_utf8_lossy(line).into_owned()
}

fn code_page_encoding(code_page: u32) -> Option<&'static encoding_rs::Encoding> {
    use encoding_rs::*;
    Some(match code_page {
        936 => GBK,
        54936 => GB18030,
        950 => BIG5,
        932 => SHIFT_JIS,
        949 => EUC_KR,
        866 => IBM866,
        874 => WINDOWS_874,
        1250 => WINDOWS_1250,
        1251 => WINDOWS_1251,
        1252 => WINDOWS_1252,
        1253 => WINDOWS_1253,
        1254 => WINDOWS_1254,
        1255 => WINDOWS_1255,
        1256 => WINDOWS_1256,
        1257 => WINDOWS_1257,
        1258 => WINDOWS_1258,
        _ => return None,
    })
}

#[cfg(windows)]
fn output_code_page() -> Option<u32> {
    Some(unsafe { windows_sys::Win32::Globalization::GetOEMCP() })
}

#[cfg(not(windows))]
fn output_code_page() -> Option<u32> {
    None
}

fn is_runtime_warning(line: &str) -> bool {
    (line.starts_with("(node:") && line.contains("Warning"))
        || (line.starts_with("(Use `") && line.contains("--trace-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tail_keeps_the_last_lines_without_control_characters() {
        let tail = StderrTail::default();
        for index in 0..2_000 {
            tail.push(format!("\u{7}noise {index}\n").as_bytes());
        }
        let text = tail.text();
        assert!(text.len() <= MAX_TAIL_CHARS);
        assert!(!text.contains('\u{7}'));
        assert!(text.ends_with("noise 1999"));
    }

    #[test]
    fn a_long_traceback_keeps_its_closing_error_line() {
        let tail = StderrTail::default();
        tail.push(b"Traceback (most recent call last):\n");
        for frame in 0..15 {
            tail.push(format!("  File \"agent/module_{frame}.py\", line {frame}, in run_step_{frame}_with_a_long_name\n").as_bytes());
        }
        tail.push(b"ValueError: the model name is not valid\n");
        let text = tail.text();
        assert!(text.chars().count() <= MAX_TAIL_CHARS);
        assert!(
            text.ends_with("ValueError: the model name is not valid"),
            "{text}"
        );
    }

    #[test]
    fn output_in_a_windows_code_page_reads_as_text() {
        let message = "'node' \u{4e0d}\u{662f}\u{5185}\u{90e8}\u{6216}\u{5916}\u{90e8}\u{547d}\u{4ee4}\u{3002}";
        let (bytes, _, _) = encoding_rs::GBK.encode(message);
        assert_eq!(decode_output(&bytes, Some(936)), message);
        assert_eq!(decode_output(message.as_bytes(), Some(936)), message);
        assert_eq!(decode_output(b"plain", None), "plain");
        assert!(decode_output(&bytes, None).starts_with("'node' "));
    }

    #[test]
    fn node_warnings_do_not_crowd_out_the_real_error() {
        let tail = StderrTail::default();
        tail.push(
            b"(node:4242) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.\n",
        );
        tail.push(b"(Use `node --trace-deprecation ...` to show where the warning was created)\n");
        tail.push(
            b"(node:98654) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.\n",
        );
        tail.push(b"(Use `DeepSeek Harness --trace-deprecation ...` to show where the warning was created)\n");
        tail.push(
            b"(node:4242) ExperimentalWarning: CommonJS module /x/y.js is loading ES Module\n",
        );
        tail.push(b"Error: connect ETIMEDOUT 104.18.0.1:443\n");
        assert_eq!(tail.text(), "Error: connect ETIMEDOUT 104.18.0.1:443");
    }
}
