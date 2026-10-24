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

    /// The last 20 non-empty lines joined by spaces, at most 1,000
    /// characters, without control characters.
    pub(crate) fn text(&self) -> String {
        let bytes: Vec<u8> = self
            .0
            .lock()
            .map(|value| value.iter().copied().collect())
            .unwrap_or_default();
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect();
        lines[lines.len().saturating_sub(MAX_TAIL_LINES)..]
            .join(" ")
            .chars()
            .filter(|value| !value.is_control() && *value != '\u{fffd}')
            .take(MAX_TAIL_CHARS)
            .collect::<String>()
            .trim()
            .to_owned()
    }
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
}
