use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::Path;

use super::LogQuery;
use crate::task_tools::MAX_OUTPUT_BYTES;

const TAIL_WINDOW: u64 = 256 * 1024;
const MAX_LINE_CHARS: usize = 500;
pub const MAX_TAIL_LINES: usize = 2_000;
pub const MAX_GREP_MATCHES: usize = 200;
const MAX_PATTERN_CHARS: usize = 200;
const MAX_SCANNED_LINE_BYTES: u64 = 64 * 1024;

fn cut(line: &str) -> String {
    let line = line.trim_end_matches('\r');
    if line.chars().count() <= MAX_LINE_CHARS {
        return line.to_owned();
    }
    let mut cut: String = line.chars().take(MAX_LINE_CHARS).collect();
    cut.push('…');
    cut
}

fn fit(lines: Vec<String>) -> String {
    let mut out = String::new();
    for line in lines {
        if out.len() + line.len() + 1 > MAX_OUTPUT_BYTES {
            break;
        }
        out.push_str(&line);
        out.push('\n');
    }
    out
}

pub fn tail(path: &Path, lines: usize) -> Result<String, String> {
    let lines = lines.clamp(1, MAX_TAIL_LINES);
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(format!("The run log could not be read: {error}")),
    };
    let length = file
        .metadata()
        .map_err(|error| format!("The run log could not be read: {error}"))?
        .len();
    let start = length.saturating_sub(TAIL_WINDOW);
    file.seek(SeekFrom::Start(start))
        .map_err(|error| format!("The run log could not be read: {error}"))?;
    let mut bytes = Vec::new();
    file.take(TAIL_WINDOW)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("The run log could not be read: {error}"))?;
    let text = String::from_utf8_lossy(&bytes);
    let mut all: Vec<&str> = text.split('\n').collect();
    if start > 0 && !all.is_empty() {
        all.remove(0);
    }
    if all.last().is_some_and(|last| last.is_empty()) {
        all.pop();
    }
    let from = all.len().saturating_sub(lines);
    let picked: Vec<String> = all[from..].iter().map(|line| cut(line)).collect();
    let mut kept = Vec::new();
    let mut size = 0usize;
    for line in picked.into_iter().rev() {
        size += line.len() + 1;
        if size > MAX_OUTPUT_BYTES {
            break;
        }
        kept.push(line);
    }
    kept.reverse();
    Ok(fit(kept))
}

pub fn grep(path: &Path, pattern: &str, max_matches: usize) -> Result<String, String> {
    if pattern.is_empty() || pattern.chars().count() > MAX_PATTERN_CHARS {
        return Err("Search for 1 to 200 characters.".into());
    }
    let max_matches = max_matches.clamp(1, MAX_GREP_MATCHES);
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(format!("The run log could not be read: {error}")),
    };
    let unreadable = |error: std::io::Error| format!("The run log could not be read: {error}");
    let mut reader = std::io::BufReader::new(file);
    let mut matches = Vec::new();
    let mut buffer = Vec::new();
    let mut number = 0u64;
    loop {
        buffer.clear();
        let read = (&mut reader)
            .take(MAX_SCANNED_LINE_BYTES)
            .read_until(b'\n', &mut buffer)
            .map_err(unreadable)?;
        if read == 0 {
            break;
        }
        if read as u64 == MAX_SCANNED_LINE_BYTES && !buffer.ends_with(b"\n") {
            skip_line(&mut reader).map_err(unreadable)?;
        }
        number += 1;
        let line = String::from_utf8_lossy(&buffer);
        if line.contains(pattern) {
            matches.push(format!("{number}: {}", cut(line.trim_end_matches('\n'))));
            if matches.len() >= max_matches {
                break;
            }
        }
    }
    Ok(fit(matches))
}

fn skip_line(reader: &mut impl BufRead) -> std::io::Result<()> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(());
        }
        match available.iter().position(|byte| *byte == b'\n') {
            Some(index) => {
                reader.consume(index + 1);
                return Ok(());
            }
            None => {
                let length = available.len();
                reader.consume(length);
            }
        }
    }
}

pub async fn answer_blocking(path: std::path::PathBuf, query: LogQuery) -> Result<String, String> {
    tokio::task::spawn_blocking(move || answer(&path, &query))
        .await
        .map_err(|_| "The run log could not be read.".to_string())?
}

pub fn answer(path: &Path, query: &LogQuery) -> Result<String, String> {
    match query {
        LogQuery::Tail { lines } => tail(path, *lines),
        LogQuery::Grep {
            pattern,
            max_matches,
        } => grep(path, pattern, *max_matches),
    }
}
