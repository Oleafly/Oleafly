use std::collections::VecDeque;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::project::{APP_LOG_FILE, PREVIOUS_APP_LOG_FILE};

const RING_CAPACITY: usize = 2000;
const PERSISTED_FILE: &str = "logs.jsonl";
const PERSISTED_TRIM_BYTES: u64 = 1_048_576;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogEntry {
    pub ts_ms: u64,
    pub level: Level,
    pub message: String,
    #[serde(default)]
    pub safe: Value,
    #[serde(default)]
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

fn log_dir() -> Option<PathBuf> {
    crate::paths::oleafly_root().ok()
}

fn load_persisted(path: &Path) -> VecDeque<LogEntry> {
    let mut ring = VecDeque::with_capacity(RING_CAPACITY);
    let Ok(file) = std::fs::File::open(path) else {
        return ring;
    };
    for line in std::io::BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(entry) = serde_json::from_str::<LogEntry>(&line) else {
            continue;
        };
        if ring.len() >= RING_CAPACITY {
            ring.pop_front();
        }
        ring.push_back(entry);
    }
    ring
}

fn rewrite_persisted(path: &Path, ring: &VecDeque<LogEntry>) -> std::io::Result<()> {
    let budget = (PERSISTED_TRIM_BYTES / 2) as usize;
    let mut kept: Vec<String> = Vec::new();
    let mut size = 0usize;
    for entry in ring.iter().rev() {
        let line = serde_json::to_string(&entry.redacted())?;
        if !kept.is_empty() && size + line.len() + 1 > budget {
            break;
        }
        size += line.len() + 1;
        kept.push(line);
    }
    let mut text = String::with_capacity(size);
    for line in kept.iter().rev() {
        text.push_str(line);
        text.push('\n');
    }
    oleafly_core::atomic::write_atomic(path, text.as_bytes())
}

fn append_persisted(path: &Path, ring: &VecDeque<LogEntry>) -> std::io::Result<()> {
    let Some(entry) = ring.back() else {
        return Ok(());
    };
    let line = serde_json::to_string(&entry.redacted())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{line}")?;
    if file.metadata()?.len() > PERSISTED_TRIM_BYTES {
        drop(file);
        rewrite_persisted(path, ring)?;
    }
    Ok(())
}

fn with_ring<R>(dir: Option<&Path>, f: impl FnOnce(&mut VecDeque<LogEntry>) -> R) -> R {
    let mut guard = RING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let ring = guard.get_or_insert_with(|| {
        dir.map(|dir| load_persisted(&dir.join(PERSISTED_FILE)))
            .unwrap_or_default()
    });
    f(ring)
}

fn push_entry(ring: &mut VecDeque<LogEntry>, dir: Option<&Path>, entry: LogEntry) {
    if ring.len() >= RING_CAPACITY {
        ring.pop_front();
    }
    ring.push_back(entry);
    if let Some(dir) = dir {
        let _ = append_persisted(&dir.join(PERSISTED_FILE), ring);
    }
}

fn app_log_line(entry: &LogEntry) -> String {
    match &entry.safe {
        Value::Null => entry.message.clone(),
        Value::Object(fields) if fields.is_empty() => entry.message.clone(),
        safe => format!("{} {}", entry.message, safe),
    }
}

pub fn log(level: Level, message: &str, safe: Value, sensitive: Value) {
    let entry = LogEntry {
        ts_ms: now_ms(),
        level,
        message: message.to_string(),
        safe,
        sensitive,
    };
    let _ = crate::project::append_app_log(app_log_line(&entry));
    let dir = log_dir();
    with_ring(dir.as_deref(), |ring| {
        push_entry(ring, dir.as_deref(), entry)
    });
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

fn build_entry(
    engine: &str,
    result: &crate::document_engine::CompileResult,
) -> (Level, &'static str, Value) {
    let safe = json!({
        "engine": engine,
        "duration_ms": result.compile_time_ms,
        "errors": result.errors.len(),
    });
    let reported = !result.errors.is_empty();
    if result.stopped {
        (Level::Info, "build stopped", safe)
    } else if result.ok && reported {
        (Level::Warning, "build succeeded with errors", safe)
    } else if result.ok {
        (Level::Info, "build succeeded", safe)
    } else if reported {
        (Level::Warning, "build failed", safe)
    } else {
        (Level::Error, "build failed", safe)
    }
}

pub fn build_finished(
    engine: &str,
    result: &crate::document_engine::CompileResult,
    project_id: &str,
    main_file: &str,
) {
    let (level, message, safe) = build_entry(engine, result);
    log(
        level,
        message,
        safe,
        json!({ "project_id": project_id, "main_file": main_file }),
    );
}

fn snapshot() -> Vec<LogEntry> {
    with_ring(log_dir().as_deref(), |ring| ring.iter().cloned().collect())
}

fn truncate_if_present(path: &Path) -> Result<(), String> {
    match std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to clear {}: {error}", path.display())),
    }
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to clear {}: {error}", path.display())),
    }
}

fn clear_entries(ring: &mut VecDeque<LogEntry>, dir: Option<&Path>) -> Result<(), String> {
    ring.clear();
    match dir {
        Some(dir) => {
            truncate_if_present(&dir.join(PERSISTED_FILE))?;
            truncate_if_present(&dir.join(APP_LOG_FILE))?;
            remove_if_present(&dir.join(PREVIOUS_APP_LOG_FILE))
        }
        None => Ok(()),
    }
}

fn ensure_app_log(dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("failed to create log folder: {error}"))?;
    let path = dir.join(APP_LOG_FILE);
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("failed to open app log: {error}"))?;
    path.canonicalize()
        .map_err(|error| format!("cannot resolve app log: {error}"))
}

const PRIVATE: &str = "[private]";
const OMITTED_QUERY: &str = "[omitted]";
const MIN_PRIVATE_VALUE: usize = 4;

struct Scrub {
    homes: Vec<String>,
    private: Option<aho_corasick::AhoCorasick>,
    redactor: crate::log_redact::Redactor,
}

fn private_values(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::String(text) if text.chars().count() >= MIN_PRIVATE_VALUE => {
            found.push(text.clone());
        }
        Value::Array(values) => values.iter().for_each(|value| private_values(value, found)),
        Value::Object(fields) => fields
            .values()
            .for_each(|value| private_values(value, found)),
        _ => {}
    }
}

fn longest_first(mut spellings: Vec<String>) -> Vec<String> {
    spellings.retain(|spelling| !spelling.is_empty());
    spellings.sort_by(|left, right| right.len().cmp(&left.len()).then_with(|| left.cmp(right)));
    spellings.dedup();
    spellings
}

fn ends_a_name(after: &str) -> bool {
    after
        .chars()
        .next()
        .is_none_or(|next| !(next.is_alphanumeric() || matches!(next, '_' | '-' | '.')))
}

fn replace_home(text: &str, spelling: &str) -> String {
    let folded = |text: &str| {
        if cfg!(windows) {
            text.to_ascii_lowercase()
        } else {
            text.to_owned()
        }
    };
    let haystack = folded(text);
    let needle = folded(spelling);
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut from = 0;
    while let Some(found) = haystack[from..].find(&needle) {
        let at = from + found;
        let end = at + needle.len();
        if ends_a_name(&text[end..]) {
            out.push_str(&text[copied..at]);
            out.push('~');
            copied = end;
        }
        from = end;
    }
    out.push_str(&text[copied..]);
    out
}

fn url_end(text: &str) -> usize {
    text.find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '`' | ')'))
        .unwrap_or(text.len())
}

fn without_url_secrets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        let start = at + 3;
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let url = &tail[..url_end(tail)];
        let authority_end = url.find(['/', '?', '#']).unwrap_or(url.len());
        let (authority, path) = url.split_at(authority_end);
        match authority.rfind('@') {
            Some(at) => {
                out.push_str(OMITTED_QUERY);
                out.push_str(&authority[at..]);
            }
            None => out.push_str(authority),
        }
        match path.find(['?', '#']) {
            Some(query) => {
                out.push_str(&path[..=query]);
                out.push_str(OMITTED_QUERY);
            }
            None => out.push_str(path),
        }
        rest = &tail[url.len()..];
    }
    out.push_str(rest);
    out
}

impl Scrub {
    fn new(entries: &[LogEntry]) -> Self {
        let mut private = Vec::new();
        for entry in entries {
            private_values(&entry.sensitive, &mut private);
        }
        Self::with(crate::project_availability::display_homes(), private)
    }

    fn with(homes: Vec<String>, private: Vec<String>) -> Self {
        let homes = homes
            .into_iter()
            .flat_map(|home| {
                if cfg!(windows) {
                    vec![home.replace('\\', "/"), home.replace('\\', "\\\\"), home]
                } else {
                    vec![home]
                }
            })
            .collect();
        let private = longest_first(private);
        Self {
            homes: longest_first(homes),
            private: (!private.is_empty())
                .then(|| {
                    aho_corasick::AhoCorasick::builder()
                        .match_kind(aho_corasick::MatchKind::LeftmostLongest)
                        .build(&private)
                        .ok()
                })
                .flatten(),
            redactor: crate::log_redact::Redactor::new(&[]),
        }
    }

    fn text(&self, text: &str) -> String {
        let mut text = self.redactor.text(&without_url_secrets(text));
        if let Some(private) = &self.private {
            let mut hidden = String::with_capacity(text.len());
            private.replace_all_with(&text, &mut hidden, |_, _, out| {
                out.push_str(PRIVATE);
                true
            });
            text = hidden;
        }
        for home in &self.homes {
            text = replace_home(&text, home);
        }
        text
    }

    fn value(&self, value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.text(text)),
            Value::Array(values) => Value::Array(values.iter().map(|v| self.value(v)).collect()),
            Value::Object(fields) => Value::Object(
                fields
                    .iter()
                    .map(|(key, value)| (key.clone(), self.value(value)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    fn entry(&self, entry: &LogEntry) -> Value {
        json!({
            "ts_ms": entry.ts_ms,
            "level": entry.level,
            "message": self.text(&entry.message),
            "safe": self.value(&entry.safe),
        })
    }
}

pub fn export_archive_to(dest: &std::path::Path, include_sensitive: bool) -> Result<(), String> {
    let entries = snapshot();
    let scrub = (!include_sensitive).then(|| Scrub::new(&entries));
    let mut lines = String::new();
    for entry in &entries {
        let line = match &scrub {
            Some(scrub) => serde_json::to_string(&scrub.entry(entry)),
            None => serde_json::to_string(entry),
        }
        .map_err(|e| format!("failed to encode log entry: {e}"))?;
        lines.push_str(&line);
        lines.push('\n');
    }
    let app_log = crate::project::read_app_log(2_000_000).unwrap_or_default();
    let app_log = match &scrub {
        Some(scrub) => scrub.text(&app_log),
        None => app_log,
    };

    let file =
        std::fs::File::create(dest).map_err(|e| format!("failed to create log archive: {e}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
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

fn validate_archive_dest(dest: &std::path::Path) -> Result<(), String> {
    if !dest.is_absolute() {
        return Err("log archive destination must be an absolute path".to_string());
    }
    let zip = dest
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
    if !zip {
        return Err("log archive destination must end in .zip".to_string());
    }
    if let Ok(meta) = dest.symlink_metadata() {
        if meta.file_type().is_symlink() {
            return Err("log archive destination must not be a symlink".to_string());
        }
    }
    let parent = dest
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "log archive destination must have a parent directory".to_string())?;
    let parent_meta = std::fs::metadata(parent)
        .map_err(|_| "log archive destination directory does not exist".to_string())?;
    if !parent_meta.is_dir() {
        return Err("log archive destination parent is not a directory".to_string());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn export_log_archive(dest: String, include_sensitive: Option<bool>) -> Result<(), String> {
    crate::path_grants::require_save(&dest)?;
    let path = std::path::Path::new(&dest);
    validate_archive_dest(path)?;
    export_archive_to(path, include_sensitive.unwrap_or(false))
}

#[tauri::command(async)]
pub fn read_log_entries() -> Vec<LogEntry> {
    snapshot()
}

#[tauri::command(async)]
pub fn clear_logs() -> Result<(), String> {
    let dir = log_dir();
    with_ring(dir.as_deref(), |ring| clear_entries(ring, dir.as_deref()))
}

#[tauri::command(async)]
pub fn reveal_app_log() -> Result<(), String> {
    let dir = crate::paths::oleafly_root()?;
    let path = ensure_app_log(&dir)?;
    crate::commands::reveal_canonical_path(&path)
}

const PAGE_MESSAGE_CHARS: usize = 8_000;

fn from_page(mut message: String) -> String {
    if let Some((cut, _)) = message.char_indices().nth(PAGE_MESSAGE_CHARS) {
        message.truncate(cut);
        message.push('…');
    }
    message
}

#[tauri::command]
pub async fn append_app_log(message: String) -> Result<(), String> {
    off_ui_thread("write the app log", move || {
        crate::project::append_app_log(from_page(message))
    })
    .await
}

#[tauri::command]
pub async fn log_frontend_error(message: String) {
    let _ = off_ui_thread("log an error", move || {
        error(&from_page(message), Value::Null, Value::Null);
        Ok(())
    })
    .await;
}

#[tauri::command]
pub async fn log_frontend_entry(level: Level, message: String) {
    let _ = off_ui_thread("log an entry", move || {
        log(level, &from_page(message), Value::Null, Value::Null);
        Ok(())
    })
    .await;
}

pub(crate) async fn off_ui_thread<T, F>(label: &'static str, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("failed to {label}: {error}"))?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn entry(ts_ms: u64, level: Level, message: &str) -> LogEntry {
        LogEntry {
            ts_ms,
            level,
            message: message.into(),
            safe: json!({ "n": ts_ms }),
            sensitive: json!({ "secret": format!("SECRET-{ts_ms}") }),
        }
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
        let mut ring = VecDeque::new();
        for i in 0..(RING_CAPACITY + 10) {
            push_entry(&mut ring, None, entry(i as u64, Level::Info, "tick"));
        }
        assert_eq!(ring.len(), RING_CAPACITY);
        assert_eq!(ring.front().unwrap().ts_ms, 10);
    }

    #[test]
    fn entries_persist_without_their_sensitive_fields() {
        let dir = tempfile::tempdir().unwrap();
        let mut ring = VecDeque::new();
        push_entry(
            &mut ring,
            Some(dir.path()),
            entry(1, Level::Warning, "sidecar exited"),
        );
        push_entry(
            &mut ring,
            Some(dir.path()),
            entry(2, Level::Error, "build failed"),
        );

        let on_disk = std::fs::read_to_string(dir.path().join(PERSISTED_FILE)).unwrap();
        assert_eq!(on_disk.lines().count(), 2);
        assert!(on_disk.contains("sidecar exited"));
        assert!(!on_disk.contains("SECRET-"));
        assert_eq!(ring[1].sensitive, json!({ "secret": "SECRET-2" }));

        let reloaded = load_persisted(&dir.path().join(PERSISTED_FILE));
        assert_eq!(reloaded.len(), 2);
        assert_eq!(reloaded[0].message, "sidecar exited");
        assert_eq!(reloaded[0].level, Level::Warning);
        assert_eq!(reloaded[1].safe, json!({ "n": 2 }));
        assert_eq!(reloaded[1].sensitive, Value::Null);
    }

    #[test]
    fn loading_skips_broken_lines_and_keeps_the_newest_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PERSISTED_FILE);
        let mut text = String::from("not json\n");
        for i in 0..(RING_CAPACITY + 5) {
            let line =
                serde_json::to_string(&entry(i as u64, Level::Info, "x").redacted()).unwrap();
            text.push_str(&line);
            text.push('\n');
        }
        std::fs::write(&path, text).unwrap();
        let ring = load_persisted(&path);
        assert_eq!(ring.len(), RING_CAPACITY);
        assert_eq!(ring.front().unwrap().ts_ms, 5);
        assert!(load_persisted(&dir.path().join("missing.jsonl")).is_empty());
    }

    #[test]
    fn a_large_file_is_trimmed_to_the_newest_half() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PERSISTED_FILE);
        let big = "x".repeat(4096);
        let mut ring = VecDeque::new();
        for i in 0..400u64 {
            push_entry(&mut ring, Some(dir.path()), entry(i, Level::Info, &big));
        }
        let size = std::fs::metadata(&path).unwrap().len();
        assert!(size <= PERSISTED_TRIM_BYTES, "file grew to {size} bytes");
        let kept = load_persisted(&path);
        assert_eq!(kept.back().unwrap().ts_ms, 399);
        assert!(kept.len() < 400);
        assert!(!dir.path().join("logs.jsonl.tmp").exists());
        append_persisted(&path, &VecDeque::new()).unwrap();
    }

    #[test]
    fn trimming_keeps_an_entry_larger_than_the_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PERSISTED_FILE);
        let mut ring = VecDeque::new();
        ring.push_back(entry(
            1,
            Level::Error,
            &"y".repeat(PERSISTED_TRIM_BYTES as usize),
        ));
        rewrite_persisted(&path, &ring).unwrap();
        assert_eq!(load_persisted(&path).len(), 1);
    }

    #[test]
    fn clearing_empties_the_ring_and_both_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut ring = VecDeque::new();
        push_entry(
            &mut ring,
            Some(dir.path()),
            entry(1, Level::Info, "kept until cleared"),
        );
        std::fs::write(dir.path().join(APP_LOG_FILE), "[1] something\n").unwrap();
        let previous = dir.path().join(PREVIOUS_APP_LOG_FILE);
        std::fs::write(&previous, "[0] older\n").unwrap();

        clear_entries(&mut ring, Some(dir.path())).unwrap();
        assert!(!previous.exists());

        assert!(ring.is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.path().join(PERSISTED_FILE)).unwrap(),
            ""
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join(APP_LOG_FILE)).unwrap(),
            ""
        );

        let empty = tempfile::tempdir().unwrap();
        clear_entries(&mut ring, Some(empty.path())).unwrap();
        assert!(!empty.path().join(APP_LOG_FILE).exists());
        clear_entries(&mut ring, None).unwrap();
    }

    #[test]
    fn clearing_reports_a_file_it_cannot_open() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(APP_LOG_FILE)).unwrap();
        let error = clear_entries(&mut VecDeque::new(), Some(dir.path())).unwrap_err();
        assert!(error.contains("failed to clear"), "{error}");
    }

    #[test]
    fn the_app_log_is_created_before_it_is_revealed() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("data");
        let path = ensure_app_log(&nested).unwrap();
        assert!(path.ends_with(APP_LOG_FILE));
        assert!(path.exists());
        std::fs::write(&path, "keep\n").unwrap();
        ensure_app_log(&nested).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "keep\n");
    }

    #[test]
    fn app_log_lines_leave_out_empty_fields() {
        let mut line = entry(1, Level::Info, "plain");
        line.safe = Value::Null;
        assert_eq!(app_log_line(&line), "plain");
        line.safe = json!({});
        assert_eq!(app_log_line(&line), "plain");
        line.safe = json!({ "code": 2 });
        assert_eq!(app_log_line(&line), "plain {\"code\":2}");
    }

    #[test]
    fn build_results_map_to_levels_and_messages() {
        let mut result = crate::document_engine::CompileResult {
            ok: true,
            compile_time_ms: 1812,
            ..Default::default()
        };
        let (level, message, safe) = build_entry("tectonic", &result);
        assert_eq!((level, message), (Level::Info, "build succeeded"));
        assert_eq!(
            safe,
            json!({ "engine": "tectonic", "duration_ms": 1812, "errors": 0 })
        );

        result.errors.push(oleafly_core::tex_errors::CompileError {
            message: "Undefined control sequence".into(),
            ..Default::default()
        });
        let (level, message, safe) = build_entry("quarto", &result);
        assert_eq!(
            (level, message),
            (Level::Warning, "build succeeded with errors")
        );
        assert_eq!(safe["errors"], 1);

        result.ok = false;
        let (level, message, _) = build_entry("tectonic", &result);
        assert_eq!((level, message), (Level::Warning, "build failed"));

        result.errors.clear();
        let (level, message, _) = build_entry("tectonic", &result);
        assert_eq!((level, message), (Level::Error, "build failed"));

        result.stopped = true;
        let (level, message, _) = build_entry("typst", &result);
        assert_eq!((level, message), (Level::Info, "build stopped"));
    }

    #[test]
    fn exported_archive_contains_no_sensitive_fields_by_default() {
        with_ring(None, |ring| {
            push_entry(
                ring,
                None,
                LogEntry {
                    ts_ms: 7,
                    level: Level::Warning,
                    message: "sidecar exited".into(),
                    safe: json!({ "code": 137 }),
                    sensitive: json!({ "stderr": "TOP-SECRET-VALUE" }),
                },
            )
        });
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("archive.zip");
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
        assert!(read_log_entries()
            .iter()
            .any(|entry| entry.message == "sidecar exited"));
    }

    #[test]
    fn the_page_can_log_a_note_or_a_warning() {
        tauri::async_runtime::block_on(log_frontend_entry(
            Level::Warning,
            "library thumbnail: Invalid PDF structure".into(),
        ));
        tauri::async_runtime::block_on(log_frontend_entry(
            Level::Info,
            "query: Ollama not reachable".into(),
        ));
        let entries = read_log_entries();
        let level_of = |message: &str| {
            entries
                .iter()
                .rev()
                .find(|entry| entry.message == message)
                .map(|entry| entry.level)
        };
        assert_eq!(
            level_of("library thumbnail: Invalid PDF structure"),
            Some(Level::Warning)
        );
        assert_eq!(level_of("query: Ollama not reachable"), Some(Level::Info));
        let parsed: Level = serde_json::from_value(json!("warning")).unwrap();
        assert_eq!(parsed, Level::Warning);
    }

    #[test]
    fn a_page_message_is_capped_at_a_character_boundary() {
        let long = "é".repeat(PAGE_MESSAGE_CHARS + 50);
        let capped = from_page(long);
        assert_eq!(capped.chars().count(), PAGE_MESSAGE_CHARS + 1);
        assert!(capped.ends_with('…'));
        assert_eq!(from_page("short".into()), "short");
    }

    #[test]
    fn the_rewritten_file_leaves_no_staging_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PERSISTED_FILE);
        let ring: VecDeque<LogEntry> = (0..3).map(|i| entry(i, Level::Info, "x")).collect();
        rewrite_persisted(&path, &ring).unwrap();
        assert_eq!(load_persisted(&path).len(), 3);
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, [PERSISTED_FILE]);
    }

    fn scrub_for(home: &str) -> Scrub {
        Scrub::with(
            vec![home.to_owned()],
            vec![
                "linked-0123456789abcdef".to_owned(),
                "thesis.tex".to_owned(),
            ],
        )
    }

    #[test]
    fn exported_text_hides_the_home_folder_queries_tokens_and_private_values() {
        let home = if cfg!(windows) {
            r"C:\Users\ada"
        } else {
            "/Users/ada"
        };
        let scrub = scrub_for(home);
        let sep = std::path::MAIN_SEPARATOR;
        let text = format!(
            "[1] opened {home}{sep}Desktop{sep}thesis.tex\n\
             [2] home is {home}\n\
             [3] fetch https://user:pw@api.example.com/v1/items?key=abc123&page=2 failed\n\
             [4] callback https://example.org/done#access_token=xyz done\n\
             [5] Authorization: Bearer abcdefghijklmnopqrstuvwx\n\
             [6] key sk-proj-abcdefghijklmnopqrstuvwxyz rejected\n\
             [7] project linked-0123456789abcdef saved\n"
        );
        let scrubbed = scrub.text(&text);
        for leaked in [
            "Users",
            "ada",
            "key=abc123",
            "page=2",
            "user:pw",
            "access_token",
            "abcdefghijklmnopqrstuvwx",
            "sk-proj-abcdefghijklmnopqrstuvwxyz",
            "linked-0123456789abcdef",
            "thesis.tex",
        ] {
            assert!(!scrubbed.contains(leaked), "{leaked} in {scrubbed}");
        }
        for kept in [
            format!("[1] opened ~{sep}Desktop{sep}[private]"),
            "[2] home is ~".to_owned(),
            "https://[omitted]@api.example.com/v1/items?[omitted] failed".to_owned(),
            "https://example.org/done#[omitted] done".to_owned(),
            "[7] project [private] saved".to_owned(),
        ] {
            assert!(scrubbed.contains(&kept), "{kept} missing from {scrubbed}");
        }
        assert_eq!(scrubbed.lines().count(), 7);
        assert_eq!(
            scrub.value(&json!({ "dir": format!("{home}{sep}a"), "n": 3 })),
            json!({ "dir": format!("~{sep}a"), "n": 3 })
        );
        let neighbour = format!("{home}m{sep}paper");
        assert_eq!(scrub.text(&neighbour), neighbour);
    }

    #[test]
    fn values_from_the_private_bucket_are_collected_once_and_longest_first() {
        let mut found = Vec::new();
        private_values(
            &json!({ "project_id": "abcd", "main_file": "chapters/intro.tex", "n": 7, "x": "ab", "list": ["abcd"] }),
            &mut found,
        );
        assert_eq!(
            longest_first(found),
            ["chapters/intro.tex".to_owned(), "abcd".to_owned()]
        );
    }

    #[test]
    fn an_export_without_private_details_scrubs_messages_too() {
        let home = crate::paths::home_dir().unwrap();
        let shown = crate::project_availability::without_verbatim_prefix(&home);
        let message = format!(
            "opened {} via https://example.org/a?token=SCRUB-ME-1",
            shown.join("Private-Folder-42").display()
        );
        with_ring(None, |ring| {
            push_entry(
                ring,
                None,
                LogEntry {
                    ts_ms: 8,
                    level: Level::Error,
                    message: message.clone(),
                    safe: Value::Null,
                    sensitive: json!({ "project_id": "private-project-77" }),
                },
            )
        });
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("scrubbed.zip");
        export_archive_to(&dest, false).unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        let mut structured = String::new();
        archive
            .by_name("structured.jsonl")
            .unwrap()
            .read_to_string(&mut structured)
            .unwrap();
        assert!(structured.contains("Private-Folder-42"), "{structured}");
        assert!(!structured.contains("SCRUB-ME-1"), "{structured}");
        assert!(!structured.contains(&shown.display().to_string().replace('\\', "\\\\")));
        let full = dir.path().join("full.zip");
        export_archive_to(&full, true).unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&full).unwrap()).unwrap();
        let mut everything = String::new();
        archive
            .by_name("structured.jsonl")
            .unwrap()
            .read_to_string(&mut everything)
            .unwrap();
        assert!(everything.contains("SCRUB-ME-1"));
        assert!(everything.contains("private-project-77"));
    }

    #[test]
    fn archive_destination_is_validated() {
        assert!(validate_archive_dest(std::path::Path::new("relative.zip")).is_err());
        let dir = std::env::temp_dir();
        assert!(validate_archive_dest(&dir.join("notes.txt")).is_err());
        assert!(validate_archive_dest(&dir.join("missing-dir/logs.zip")).is_err());
        assert!(validate_archive_dest(&dir.join("logs.zip")).is_ok());
    }
}
