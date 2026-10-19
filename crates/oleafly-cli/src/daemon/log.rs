//! The helper's log: JSON lines in `<data>/daemon/helper.log`, rotated at
//! 5 MiB (one older file kept). Every value is cut to 2 KiB and passes a
//! matcher built from the keys and server values the helper knows, so a
//! provider error that echoes a key never lands in the log.
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use serde_json::{Map, Value};

pub const LOG_ROTATE_BYTES: u64 = 5 << 20;
const MAX_FIELD_BYTES: usize = 2 * 1024;
const MASK: &str = "[redacted]";

struct Inner {
    file: Option<File>,
    secrets: Vec<String>,
    matcher: Option<AhoCorasick>,
}

pub struct HelperLog {
    path: PathBuf,
    to_stderr: bool,
    inner: Mutex<Inner>,
}

fn build_matcher(secrets: &[String]) -> Option<AhoCorasick> {
    let values: Vec<&str> = secrets
        .iter()
        .map(String::as_str)
        .filter(|value| value.len() >= 6)
        .collect();
    if values.is_empty() {
        return None;
    }
    AhoCorasickBuilder::new()
        .match_kind(MatchKind::LeftmostLongest)
        .build(&values)
        .ok()
}

fn open(path: &Path) -> Option<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).ok()?;
    oleafly_secrets::fsperm::harden_file(path);
    Some(file)
}

fn cut(text: &str) -> &str {
    if text.len() <= MAX_FIELD_BYTES {
        return text;
    }
    let mut end = MAX_FIELD_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

impl HelperLog {
    pub fn open(path: &Path, secrets: Vec<String>, to_stderr: bool) -> Self {
        let matcher = build_matcher(&secrets);
        Self {
            path: path.to_path_buf(),
            to_stderr,
            inner: Mutex::new(Inner {
                file: open(path),
                secrets,
                matcher,
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Adds secrets the helper learned (a task's keys and server values).
    pub fn add_secrets(&self, secrets: impl IntoIterator<Item = String>) {
        let mut inner = self.lock();
        let before = inner.secrets.len();
        for secret in secrets {
            let secret = secret.trim().to_string();
            if secret.len() >= 6 && !inner.secrets.contains(&secret) {
                inner.secrets.push(secret);
            }
        }
        if inner.secrets.len() != before {
            inner
                .secrets
                .sort_by_key(|value| std::cmp::Reverse(value.len()));
            inner.matcher = build_matcher(&inner.secrets);
        }
    }

    /// `text` as the log may hold it.
    pub fn redact(&self, text: &str) -> String {
        let inner = self.lock();
        redact_with(cut(text), inner.matcher.as_ref())
    }

    fn rotate(&self, inner: &mut Inner) {
        let large =
            std::fs::metadata(&self.path).is_ok_and(|metadata| metadata.len() >= LOG_ROTATE_BYTES);
        if !large {
            return;
        }
        inner.file = None;
        let older = self.path.with_extension("log.1");
        let _ = std::fs::remove_file(&older);
        let _ = std::fs::rename(&self.path, &older);
        inner.file = open(&self.path);
    }

    /// One line: `{"ts", "level", "event", field: value, …}`.
    pub fn event(&self, level: &str, event: &str, fields: &[(&str, &str)]) {
        let mut inner = self.lock();
        let mut line = Map::new();
        line.insert("ts".into(), Value::from(super::state::now_ms()));
        line.insert("level".into(), Value::from(level));
        line.insert("event".into(), Value::from(event));
        for (name, value) in fields {
            line.insert(
                (*name).to_string(),
                Value::from(redact_with(cut(value), inner.matcher.as_ref())),
            );
        }
        let mut text = Value::Object(line).to_string();
        text.push('\n');
        if self.to_stderr {
            let _ = std::io::stderr().write_all(text.as_bytes());
        }
        self.rotate(&mut inner);
        if inner.file.is_none() {
            inner.file = open(&self.path);
        }
        if let Some(file) = inner.file.as_mut() {
            let _ = file.write_all(text.as_bytes());
        }
    }
}

pub(crate) fn redact_with(text: &str, matcher: Option<&AhoCorasick>) -> String {
    let Some(matcher) = matcher else {
        return text.to_string();
    };
    let mut redacted = String::with_capacity(text.len());
    let mut copied = 0;
    for found in matcher.find_iter(text) {
        redacted.push_str(&text[copied..found.start()]);
        redacted.push_str(MASK);
        copied = found.end();
    }
    redacted.push_str(&text[copied..]);
    redacted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_rotates_at_5_mib_and_redacts_known_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("helper.log");
        let log = HelperLog::open(&path, vec!["sk-live-1".into()], false);
        log.event("error", "provider", &[("message", "bad key sk-live-1")]);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("sk-live-1") && text.contains("[redacted]"));
        let line: Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
        assert_eq!(
            (line["level"].clone(), line["event"].clone()),
            (Value::from("error"), Value::from("provider"))
        );

        log.add_secrets(vec!["mcp-env-secret".to_string()]);
        log.event("info", "mcp", &[("detail", "TOKEN=mcp-env-secret")]);
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("mcp-env-secret"));

        let filler = "x".repeat(MAX_FIELD_BYTES);
        for _ in 0..((LOG_ROTATE_BYTES as usize / MAX_FIELD_BYTES) + 10) {
            log.event("info", "fill", &[("text", &filler)]);
        }
        assert!(path.with_extension("log.1").exists());
        assert!(std::fs::metadata(&path).unwrap().len() < LOG_ROTATE_BYTES);
    }

    #[test]
    fn long_values_are_cut_to_2_kib() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("helper.log");
        let log = HelperLog::open(&path, Vec::new(), false);
        log.event("info", "long", &[("text", &"é".repeat(5_000))]);
        let line: Value = serde_json::from_str(
            std::fs::read_to_string(&path)
                .unwrap()
                .lines()
                .next()
                .unwrap(),
        )
        .unwrap();
        assert!(line["text"].as_str().unwrap().len() <= MAX_FIELD_BYTES);
    }
}
