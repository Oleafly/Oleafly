use std::borrow::Cow;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const APP_LOG_FILE: &str = "app.log";
pub const PREVIOUS_APP_LOG_FILE: &str = "app.log.1";
const LIMIT_BYTES: u64 = 8 * 1024 * 1024;
const ROTATION_RETRY: Duration = Duration::from_secs(60);

static WRITING: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Clone, Debug)]
pub struct AppLog {
    root: PathBuf,
}

impl AppLog {
    pub fn at(data_root: &Path) -> AppLog {
        AppLog {
            root: data_root.to_path_buf(),
        }
    }

    pub fn write(&self, message: &str) -> Result<(), String> {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or(0);
        append_line(&self.root.join(APP_LOG_FILE), secs, message, LIMIT_BYTES)
    }

    pub fn read(&self, max_bytes: usize) -> Result<String, String> {
        let current = tail(&self.root.join(APP_LOG_FILE), max_bytes)?;
        let left = max_bytes.saturating_sub(current.len());
        let mut text = if left > 0 {
            tail(&self.root.join(PREVIOUS_APP_LOG_FILE), left)?
        } else {
            Vec::new()
        };
        text.extend_from_slice(&current);
        Ok(String::from_utf8_lossy(&text).into_owned())
    }
}

fn breaks_line(character: char) -> bool {
    (character.is_control() && character != '\t') || matches!(character, '\u{2028}' | '\u{2029}')
}

fn single_line(message: &str) -> Cow<'_, str> {
    if !message.chars().any(breaks_line) {
        return Cow::Borrowed(message);
    }
    let mut line = String::with_capacity(message.len() + 16);
    for character in message.chars() {
        match character {
            '\n' => line.push_str("\\n"),
            '\r' => line.push_str("\\r"),
            other if breaks_line(other) => line.extend(other.escape_unicode()),
            other => line.push(other),
        }
    }
    Cow::Owned(line)
}

fn rotate(log_path: &Path, secs: u64) -> bool {
    let previous = log_path.with_file_name(PREVIOUS_APP_LOG_FILE);
    let Err(error) = std::fs::rename(log_path, &previous) else {
        return true;
    };
    let Ok(mut file) = std::fs::OpenOptions::new().write(true).open(log_path) else {
        return false;
    };
    let copied = std::fs::copy(log_path, &previous).is_ok();
    if file.set_len(0).is_err() {
        return false;
    }
    let kept = if copied {
        "copied its lines to app.log.1"
    } else {
        "dropped its older lines"
    };
    let _ = writeln!(
        file,
        "[{secs}] app.log could not be moved aside ({}), so Oleafly {kept}",
        single_line(&error.to_string())
    );
    true
}

fn append_line(log_path: &Path, secs: u64, message: &str, limit: u64) -> Result<(), String> {
    let line = format!("[{secs}] {}\n", single_line(message));
    let mut retry_rotation_at = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
    let open = || {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .map_err(|error| format!("failed to open app log: {error}"))
    };
    let size = |file: &std::fs::File| file.metadata().map_or(0, |meta| meta.len());
    let mut file = open()?;
    if size(&file) > limit && retry_rotation_at.is_none_or(|at| Instant::now() >= at) {
        drop(file);
        *retry_rotation_at = (!rotate(log_path, secs)).then(|| Instant::now() + ROTATION_RETRY);
        file = open()?;
    }
    if size(&file) > limit.saturating_mul(2) {
        return Err("the app log is full and could not be moved aside".into());
    }
    file.write_all(line.as_bytes())
        .map_err(|error| format!("failed to write app log: {error}"))
}

fn tail(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("failed to read app log: {error}")),
    };
    let len = file
        .metadata()
        .map_err(|error| format!("failed to read app log: {error}"))?
        .len();
    let wanted = u64::try_from(max_bytes).unwrap_or(u64::MAX).min(len);
    file.seek(SeekFrom::Start(len - wanted))
        .map_err(|error| format!("failed to read app log: {error}"))?;
    let mut tail = Vec::with_capacity(usize::try_from(wanted).unwrap_or(0));
    file.take(wanted)
        .read_to_end(&mut tail)
        .map_err(|error| format!("failed to read app log: {error}"))?;
    Ok(tail)
}

#[cfg(test)]
mod tests {
    use super::{append_line, AppLog, APP_LOG_FILE, PREVIOUS_APP_LOG_FILE};

    #[test]
    fn a_full_log_moves_aside_and_reading_joins_both_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(APP_LOG_FILE);
        for line in 0..10 {
            append_line(&path, line, &format!("first {line}"), 60).unwrap();
        }
        let previous = std::fs::read_to_string(dir.path().join(PREVIOUS_APP_LOG_FILE)).unwrap();
        let current = std::fs::read_to_string(&path).unwrap();
        assert!(previous.ends_with("first 9\n") || current.ends_with("first 9\n"));
        assert!(std::fs::metadata(&path).unwrap().len() <= 60 + 16);
        assert!(previous.len() <= 60 + 16);

        let log = AppLog::at(dir.path());
        let everything = log.read(10_000).unwrap();
        assert_eq!(everything, format!("{previous}{current}"));
        assert!(everything.ends_with("first 9\n"));
        let tail = log.read(12).unwrap();
        assert_eq!(tail.len(), 12);
        assert!(everything.ends_with(&tail));
        assert_eq!(log.read(0).unwrap(), "");
        assert_eq!(
            AppLog::at(tempfile::tempdir().unwrap().path())
                .read(100)
                .unwrap(),
            ""
        );
    }

    #[test]
    fn a_message_cannot_start_a_line_of_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(APP_LOG_FILE);
        let forged = "opened\n[1795000001] Navigation guard kept main\r[2] x\u{2028}y\u{1b}[31m";
        append_line(&path, 1_795_000_000, forged, u64::MAX).unwrap();
        append_line(&path, 1_795_000_002, "plain\ttabbed", u64::MAX).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.split('\n').filter(|line| !line.is_empty()).collect();
        assert_eq!(
            lines,
            [
                "[1795000000] opened\\n[1795000001] Navigation guard kept main\\r[2] x\\u{2028}y\\u{1b}[31m",
                "[1795000002] plain\ttabbed",
            ]
        );
    }

    #[test]
    fn a_log_that_cannot_be_moved_aside_is_still_kept_small() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(APP_LOG_FILE);
        let blocked = dir.path().join(PREVIOUS_APP_LOG_FILE);
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(blocked.join("keep"), "x").unwrap();
        for line in 0..200 {
            append_line(&path, line, &format!("line {line}"), 120).unwrap();
            assert!(
                std::fs::metadata(&path).unwrap().len() <= 120 + 160,
                "{line}"
            );
        }
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("app.log could not be moved aside"), "{text}");
        assert!(text.contains("dropped its older lines"), "{text}");
        assert!(text.ends_with("line 199\n"), "{text}");
        assert!(blocked.is_dir());
    }

    #[test]
    fn lines_logged_at_the_same_time_never_interleave() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(APP_LOG_FILE);
        let padding = "x".repeat(300);
        let writers: Vec<_> = (0..12)
            .map(|writer| {
                let path = path.clone();
                let padding = padding.clone();
                std::thread::spawn(move || {
                    for line in 0..150 {
                        let message = format!("writer {writer} line {line} {padding}");
                        append_line(&path, 1_795_000_000 + line, &message, u64::MAX).unwrap();
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 12 * 150);
        for line in lines {
            let (stamp, message) = line.split_once("] ").unwrap();
            assert!(
                stamp.strip_prefix('[').unwrap().parse::<u64>().is_ok(),
                "{line}"
            );
            let words: Vec<&str> = message.splitn(5, ' ').collect();
            assert_eq!(words[0], "writer", "{line}");
            assert_eq!(words[2], "line", "{line}");
            assert_eq!(words[4], padding, "{line}");
        }
    }
}
