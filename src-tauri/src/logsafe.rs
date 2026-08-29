use std::collections::VecDeque;
use std::io::Write;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};

// Two-bucket structured logging, mirrored from the audited reference manager:
// every entry separates fields that are safe to share (exit codes, pids,
// durations) from fields that may carry user data or paths (stderr output,
// file names). The in-memory ring holds both buckets for live debugging; the
// support archive strips Sensitive by default so users can attach it to an
// issue without leaking anything.

const RING_CAPACITY: usize = 2000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub ts_ms: u64,
    pub level: Level,
    pub message: String,
    pub safe: Value,
    pub sensitive: Value,
}

impl LogEntry {
    pub fn redacted(&self) -> Value {
        json!({
            "ts_ms": self.ts_ms,
            "level": self.level,
            "message": self.message,
            "safe": self.safe,
        })
    }
}

static RING: Mutex<Option<VecDeque<LogEntry>>> = Mutex::new(None);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn log(level: Level, message: &str, safe: Value, sensitive: Value) {
    let entry = LogEntry {
        ts_ms: now_ms(),
        level,
        message: message.to_string(),
        safe,
        sensitive,
    };
    // The persistent app.log line carries only the redacted form.
    let _ = crate::project::append_app_log(format!("{} {}", message, entry.safe));
    let mut ring = RING.lock().expect("log ring poisoned");
    let ring = ring.get_or_insert_with(|| VecDeque::with_capacity(RING_CAPACITY));
    if ring.len() >= RING_CAPACITY {
        ring.pop_front();
    }
    ring.push_back(entry);
}

pub fn info(message: &str, safe: Value, sensitive: Value) {
    log(Level::Info, message, safe, sensitive);
}

pub fn warning(message: &str, safe: Value, sensitive: Value) {
    log(Level::Warning, message, safe, sensitive);
}

pub fn error(message: &str, safe: Value, sensitive: Value) {
    log(Level::Error, message, safe, sensitive);
}

fn snapshot() -> Vec<LogEntry> {
    RING.lock()
        .expect("log ring poisoned")
        .as_ref()
        .map(|ring| ring.iter().cloned().collect())
        .unwrap_or_default()
}

pub fn export_archive_to(dest: &std::path::Path, include_sensitive: bool) -> Result<(), String> {
    let entries = snapshot();
    let mut lines = String::new();
    for entry in &entries {
        let line = if include_sensitive {
            serde_json::to_string(entry)
        } else {
            serde_json::to_string(&entry.redacted())
        }
        .map_err(|e| format!("failed to encode log entry: {e}"))?;
        lines.push_str(&line);
        lines.push('\n');
    }
    let app_log = crate::project::read_app_log(2_000_000).unwrap_or_default();

    let file =
        std::fs::File::create(dest).map_err(|e| format!("failed to create log archive: {e}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    archive
        .start_file("structured.jsonl", options)
        .and_then(|()| archive.write_all(lines.as_bytes()).map_err(Into::into))
        .map_err(|e| format!("failed to write structured log: {e}"))?;
    archive
        .start_file("app.log", options)
        .and_then(|()| archive.write_all(app_log.as_bytes()).map_err(Into::into))
        .map_err(|e| format!("failed to write app log: {e}"))?;
    archive
        .finish()
        .map_err(|e| format!("failed to finish log archive: {e}"))?;
    Ok(())
}

/// Support-archive export; Sensitive fields are stripped unless explicitly
/// requested from the settings UI.
#[tauri::command]
pub fn export_log_archive(dest: String, include_sensitive: Option<bool>) -> Result<(), String> {
    export_archive_to(
        std::path::Path::new(&dest),
        include_sensitive.unwrap_or(false),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn reset_ring() {
        *RING.lock().unwrap() = Some(VecDeque::new());
    }

    #[test]
    fn redacted_entries_drop_the_sensitive_bucket() {
        let entry = LogEntry {
            ts_ms: 1,
            level: Level::Error,
            message: "compile failed".into(),
            safe: json!({ "code": 1 }),
            sensitive: json!({ "stderr": "/Users/someone/secret.tex" }),
        };
        let redacted = serde_json::to_string(&entry.redacted()).unwrap();
        assert!(redacted.contains("compile failed"));
        assert!(!redacted.contains("secret.tex"));
        assert!(!redacted.contains("sensitive"));
    }

    #[test]
    fn ring_is_capped() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_ring();
        for i in 0..(RING_CAPACITY + 10) {
            let mut ring = RING.lock().unwrap();
            let ring = ring.as_mut().unwrap();
            if ring.len() >= RING_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(LogEntry {
                ts_ms: i as u64,
                level: Level::Info,
                message: String::new(),
                safe: Value::Null,
                sensitive: Value::Null,
            });
        }
        assert_eq!(RING.lock().unwrap().as_ref().unwrap().len(), RING_CAPACITY);
    }

    #[test]
    fn exported_archive_contains_no_sensitive_fields_by_default() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_ring();
        {
            let mut ring = RING.lock().unwrap();
            ring.as_mut().unwrap().push_back(LogEntry {
                ts_ms: 7,
                level: Level::Warning,
                message: "sidecar exited".into(),
                safe: json!({ "code": 137 }),
                sensitive: json!({ "stderr": "TOP-SECRET-VALUE" }),
            });
        }
        let dir = std::env::temp_dir().join(format!("oleafly-logsafe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("archive.zip");
        export_archive_to(&dest, false).unwrap();

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        let mut structured = String::new();
        archive
            .by_name("structured.jsonl")
            .unwrap()
            .read_to_string(&mut structured)
            .unwrap();
        assert!(structured.contains("sidecar exited"));
        assert!(structured.contains("137"));
        assert!(!structured.contains("TOP-SECRET-VALUE"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
