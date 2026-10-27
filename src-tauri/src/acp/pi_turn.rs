use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const MAX_MAP_BYTES: u64 = 2 * 1024 * 1024;
const TAIL_BYTES: u64 = 16 * 1024;
const MAX_ERROR_CHARS: usize = 500;
const CLOCK_SLACK_MS: u64 = 5_000;

pub(super) fn last_turn_error(home: &Path, native: &str, since: u64) -> Option<String> {
    let pi = home.join(".pi").canonicalize().ok()?;
    let file = session_file(&pi, native)?;
    let message = last_message(&file)?;
    let message = &message["message"];
    let stale = message["timestamp"]
        .as_u64()
        .is_some_and(|at| at + CLOCK_SLACK_MS < since);
    if message["role"] != "assistant" || message["stopReason"] != "error" || stale {
        return None;
    }
    let error: String = message["errorMessage"]
        .as_str()?
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_ERROR_CHARS)
        .collect();
    let error = error.split_whitespace().collect::<Vec<_>>().join(" ");
    (!error.is_empty()).then_some(error)
}

fn session_file(pi: &Path, native: &str) -> Option<PathBuf> {
    let mut bytes = Vec::new();
    std::fs::File::open(pi.join("pi-acp").join("session-map.json"))
        .ok()?
        .take(MAX_MAP_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_MAP_BYTES {
        return None;
    }
    let map: Value = serde_json::from_slice(&bytes).ok()?;
    let file = Path::new(map["sessions"][native]["sessionFile"].as_str()?);
    if !file.is_absolute()
        || file
            .extension()
            .is_none_or(|extension| extension != "jsonl")
    {
        return None;
    }
    let file = file.canonicalize().ok()?;
    (file.starts_with(pi) && file.is_file()).then_some(file)
}

fn last_message(file: &Path) -> Option<Value> {
    let mut handle = std::fs::File::open(file).ok()?;
    let length = handle.metadata().ok()?.len();
    let start = length.saturating_sub(TAIL_BYTES);
    handle.seek(SeekFrom::Start(start)).ok()?;
    let mut tail = Vec::new();
    handle.take(TAIL_BYTES).read_to_end(&mut tail).ok()?;
    let text = String::from_utf8_lossy(&tail);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    lines
        .into_iter()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|entry| entry["type"] == "message")
}
