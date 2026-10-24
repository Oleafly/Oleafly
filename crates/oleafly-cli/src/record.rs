//! What the last CLI build left in the build folder: `oleafly-build.json`
//! (result, errors, diagnostics) and `oleafly-build.log` (the whole bounded
//! compiler log), so `oleafly log` and `oleafly context` can report on it.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use oleafly_core::engine_spec::ENTRY_STEM;
use oleafly_core::{Engine, LogDiagnostic};
use serde::{Deserialize, Serialize};

use crate::native::BuildError;

pub const RECORD_FILE: &str = "oleafly-build.json";
pub const LOG_FILE: &str = "oleafly-build.log";
pub const RECORD_SCHEMA: u32 = 1;
const MAX_RECORD_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BuildRecord {
    pub schema_version: u32,
    /// The CLI version that built it.
    pub version: String,
    pub engine: Engine,
    pub main_document: String,
    pub ok: bool,
    pub finished_at_ms: u64,
    pub compile_time_ms: u64,
    #[serde(default)]
    pub output_id: Option<String>,
    #[serde(default)]
    pub errors: Vec<BuildError>,
    #[serde(default)]
    pub diagnostics: Vec<LogDiagnostic>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// Writes the record and its log (each in one rename).
pub fn write_record(build_dir: &Path, record: &BuildRecord, log: &str) -> std::io::Result<()> {
    let text = serde_json::to_vec_pretty(record).map_err(std::io::Error::other)?;
    oleafly_core::atomic::write_atomic(&build_dir.join(LOG_FILE), log.as_bytes())?;
    oleafly_core::atomic::write_atomic(&build_dir.join(RECORD_FILE), &text)
}

/// Opens `path` to read it, only when it is a regular file and not a link.
/// A project can ship files in its build folder that point elsewhere
/// (`.oleafly/build/oleafly-build.log` -> a key file), and what a build
/// leaves there is never a link, so reading through one would hand a
/// stranger's choice of file to whoever runs `oleafly log` (or an agent).
pub fn open_regular_file(path: &Path) -> std::io::Result<std::fs::File> {
    let refused = || {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{} isn't a regular file", path.display()),
        )
    };
    if !std::fs::symlink_metadata(path)?.is_file() {
        return Err(refused());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Closes the gap between the check and the open: a link swapped in
        // fails, and a pipe swapped in doesn't wait for a writer.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if file.metadata()?.is_file() {
        Ok(file)
    } else {
        Err(refused())
    }
}

/// The record (≤ 8 MiB), or `None` when missing or unreadable.
pub fn read_record(build_dir: &Path) -> Option<BuildRecord> {
    let path = build_dir.join(RECORD_FILE);
    let mut file = open_regular_file(&path).ok()?;
    if file.metadata().ok()?.len() > MAX_RECORD_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_RECORD_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The last `max_lines` lines of `path`, reading at most `max_bytes` from its
/// end (so a 1 GB log costs no more than a small one). `true` when lines were
/// left out.
pub fn read_tail(path: &Path, max_lines: usize, max_bytes: u64) -> std::io::Result<(String, bool)> {
    let mut file = open_regular_file(path)?;
    let length = file.metadata()?.len();
    let start = length.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity((length - start) as usize);
    file.take(max_bytes).read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    let mut truncated = start > 0;
    if start > 0 {
        // The first line is probably cut; drop it.
        if let Some(newline) = text.find('\n') {
            text.drain(..=newline);
        }
    }
    let ends_with_newline = text.ends_with('\n');
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > max_lines {
        truncated = true;
    }
    let mut tail = lines[lines.len().saturating_sub(max_lines)..].join("\n");
    if ends_with_newline && !tail.is_empty() {
        tail.push('\n');
    }
    Ok((tail, truncated))
}

/// The last `max_chars` characters of `text`, starting at a line when one
/// begins inside that window.
pub fn tail_chars(text: &str, max_chars: usize) -> (String, bool) {
    let count = text.chars().count();
    if count <= max_chars {
        return (text.to_string(), false);
    }
    let start = text
        .char_indices()
        .nth(count - max_chars)
        .map_or(0, |(index, _)| index);
    let window = &text[start..];
    let window = match window.find('\n') {
        Some(newline) if newline + 1 < window.len() => &window[newline + 1..],
        _ => window,
    };
    (window.to_string(), true)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSource {
    /// The CLI's own record and log.
    Cli,
    /// The engine's log (the app or another tool built last).
    Engine,
}

#[derive(Clone, Debug)]
pub struct LatestLog {
    pub source: LogSource,
    pub path: PathBuf,
    pub record: Option<BuildRecord>,
}

fn is_regular_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn modified_ms(path: &Path) -> Option<u64> {
    let metadata = std::fs::symlink_metadata(path)
        .ok()
        .filter(std::fs::Metadata::is_file)?;
    let modified = metadata.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|elapsed| elapsed.as_millis() as u64)
}

/// The newest log in the build folder: the CLI's record when no engine log
/// or PDF is newer than it, else the engine's `_oleafly_entry.log`.
pub fn latest_log(build_dir: &Path, main_document: &str) -> Option<LatestLog> {
    let engine_log = build_dir.join(format!("{ENTRY_STEM}.log"));
    let engine_pdf = build_dir.join(format!("{ENTRY_STEM}.pdf"));
    let engine_time = [modified_ms(&engine_log), modified_ms(&engine_pdf)]
        .into_iter()
        .flatten()
        .max();
    let record = read_record(build_dir)
        .filter(|record| record.main_document == main_document || main_document.is_empty());
    let cli_log = build_dir.join(LOG_FILE);
    if let Some(record) = record {
        // A margin for file systems that round times.
        let newer_engine = engine_time.is_some_and(|time| time > record.finished_at_ms + 2_000);
        if !newer_engine && is_regular_file(&cli_log) {
            return Some(LatestLog {
                source: LogSource::Cli,
                path: cli_log,
                record: Some(record),
            });
        }
    }
    is_regular_file(&engine_log).then_some(LatestLog {
        source: LogSource::Engine,
        path: engine_log,
        record: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn record(finished_at_ms: u64) -> BuildRecord {
        BuildRecord {
            schema_version: RECORD_SCHEMA,
            version: "0.4.8".into(),
            engine: Engine::Tectonic,
            main_document: "main.tex".into(),
            ok: true,
            finished_at_ms,
            compile_time_ms: 10,
            output_id: Some("pdf-sha256:1:ab".into()),
            errors: Vec::new(),
            diagnostics: Vec::new(),
        }
    }

    #[test]
    fn records_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        write_record(dir.path(), &record(5), "log text").unwrap();
        assert_eq!(read_record(dir.path()), Some(record(5)));
        assert_eq!(
            std::fs::read_to_string(dir.path().join(LOG_FILE)).unwrap(),
            "log text"
        );
    }

    #[test]
    fn tail_reads_the_last_lines_of_a_huge_log_without_loading_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.log");
        let file = std::fs::File::create(&path).unwrap();
        let size: u64 = if cfg!(unix) { 1 << 30 } else { 64 << 20 };
        file.set_len(size).unwrap();
        drop(file);
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        file.write_all(b"\nline A\nline B\n").unwrap();
        drop(file);
        let started = std::time::Instant::now();
        let (tail, truncated) = read_tail(&path, 2, 4 << 20).unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
        assert_eq!(tail, "line A\nline B\n");
        assert!(truncated);
    }

    #[test]
    fn tails_cut_at_a_line_start() {
        let (tail, truncated) = tail_chars("first line\nsecond line\nthird", 12);
        assert!(truncated);
        assert_eq!(tail, "third");
        assert_eq!(tail_chars("short", 100), ("short".to_string(), false));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_the_build_folder_is_never_read_through() {
        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join("secret.txt");
        std::fs::write(&secret, "private key\n").unwrap();
        let build = dir.path().join("build");
        std::fs::create_dir(&build).unwrap();
        for name in [LOG_FILE, "_oleafly_entry.log", RECORD_FILE] {
            std::os::unix::fs::symlink(&secret, build.join(name)).unwrap();
        }
        assert!(open_regular_file(&build.join(LOG_FILE)).is_err());
        assert!(read_tail(&build.join(LOG_FILE), 10, 1024).is_err());
        assert_eq!(read_record(&build), None);
        // Not the CLI's log and not the engine's: neither is a regular file.
        std::fs::remove_file(build.join(RECORD_FILE)).unwrap();
        std::fs::write(
            build.join(RECORD_FILE),
            serde_json::to_vec(&record(5)).unwrap(),
        )
        .unwrap();
        assert!(latest_log(&build, "main.tex").is_none());
        // A real file is read as before.
        std::fs::remove_file(build.join(LOG_FILE)).unwrap();
        std::fs::write(build.join(LOG_FILE), "cli\n").unwrap();
        let latest = latest_log(&build, "main.tex").unwrap();
        assert_eq!(latest.source, LogSource::Cli);
        assert_eq!(read_tail(&latest.path, 10, 1024).unwrap().0, "cli\n");
    }

    #[cfg(unix)]
    #[test]
    fn a_pipe_in_the_build_folder_is_refused_without_waiting_for_a_writer() {
        let dir = tempfile::tempdir().unwrap();
        let pipe = dir.path().join("oleafly-build.log");
        let path = std::ffi::CString::new(pipe.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
        let started = std::time::Instant::now();
        assert!(open_regular_file(&pipe).is_err());
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }

    #[test]
    fn log_prefers_the_newest_build_and_says_where_it_came_from() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("_oleafly_entry.log"), "engine").unwrap();
        write_record(dir.path(), &record(now_ms() + 10_000), "cli").unwrap();
        assert_eq!(
            latest_log(dir.path(), "main.tex").unwrap().source,
            LogSource::Cli
        );
        write_record(dir.path(), &record(1), "cli").unwrap();
        assert_eq!(
            latest_log(dir.path(), "main.tex").unwrap().source,
            LogSource::Engine
        );
        let empty = tempfile::tempdir().unwrap();
        assert!(latest_log(empty.path(), "main.tex").is_none());
    }
}
