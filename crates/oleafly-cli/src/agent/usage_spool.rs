use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const SPOOL_FILE: &str = "usage-spool.jsonl";
const LOCK_FILE: &str = "usage-spool.lock";
const LOCK_BUDGET: Duration = Duration::from_secs(5);
const MAX_LINE_BYTES: usize = 16 * 1024;
const MAX_READ_BYTES: u64 = 32 << 20;
pub const COMPACT_AFTER_BYTES: u64 = 8 << 20;
pub const KEEP_FOR_MS: i64 = 45 * 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSpoolEvent {
    pub id: String,
    pub source: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub input_tokens: Option<u32>,
    #[serde(default)]
    pub output_tokens: Option<u32>,
    #[serde(default)]
    pub cache_read_tokens: Option<u32>,
    #[serde(default)]
    pub cache_write_tokens: Option<u32>,
    #[serde(default)]
    pub cost_usd: Option<f64>,
    pub status: String,
    pub at: i64,
}

pub fn event_id(source: &str) -> String {
    format!(
        "{source}-{}-{}-{:08x}",
        crate::record::now_ms(),
        std::process::id(),
        rand::random::<u32>()
    )
}

pub fn spool_path(data_root: &Path) -> PathBuf {
    data_root.join("daemon").join(SPOOL_FILE)
}

fn spool_dir(data_root: &Path) -> io::Result<PathBuf> {
    let dir = data_root.join("daemon");
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

fn locked(dir: &Path) -> io::Result<File> {
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join(LOCK_FILE))?;
    oleafly_core::locking::lock_file(&lock, true, LOCK_BUDGET)?;
    Ok(lock)
}

fn open_append(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    oleafly_secrets::fsperm::harden_file(path);
    Ok(file)
}

pub fn append(data_root: &Path, event: &UsageSpoolEvent) -> io::Result<()> {
    let dir = spool_dir(data_root)?;
    let mut line = serde_json::to_vec(event).map_err(io::Error::other)?;
    line.push(b'\n');
    if line.len() > MAX_LINE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the usage event is too large",
        ));
    }
    let _lock = locked(&dir)?;
    let mut file = open_append(&dir.join(SPOOL_FILE))?;
    file.write_all(&line)?;
    file.flush()
}

pub fn read_all(data_root: &Path) -> io::Result<Vec<UsageSpoolEvent>> {
    let path = spool_path(data_root);
    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let length = file.metadata()?.len();
    let skip_partial = length > MAX_READ_BYTES;
    if skip_partial {
        file.seek(SeekFrom::Start(length - MAX_READ_BYTES))?;
    }
    let mut reader = BufReader::new(file.take(MAX_READ_BYTES));
    let mut events = Vec::new();
    let mut line = Vec::new();
    let mut first = true;
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 {
            break;
        }
        if std::mem::take(&mut first) && skip_partial {
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            continue;
        }
        if let Ok(event) = serde_json::from_slice::<UsageSpoolEvent>(&line) {
            events.push(event);
        }
    }
    Ok(events)
}

pub fn read_since(
    data_root: &Path,
    task_id: &str,
    since_ms: i64,
) -> io::Result<Vec<UsageSpoolEvent>> {
    Ok(read_all(data_root)?
        .into_iter()
        .filter(|event| event.task_id.as_deref() == Some(task_id) && event.at >= since_ms)
        .collect())
}

pub fn compact(data_root: &Path, keep_after_ms: i64) -> io::Result<bool> {
    let path = spool_path(data_root);
    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.len() > COMPACT_AFTER_BYTES => {}
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    }
    let dir = spool_dir(data_root)?;
    let _lock = locked(&dir)?;
    let kept: Vec<UsageSpoolEvent> = read_all(data_root)?
        .into_iter()
        .filter(|event| event.at >= keep_after_ms)
        .collect();
    let mut bytes = Vec::new();
    for event in &kept {
        serde_json::to_writer(&mut bytes, event).map_err(io::Error::other)?;
        bytes.push(b'\n');
    }
    oleafly_secrets::fs::write_atomic(&path, &bytes).map_err(io::Error::other)?;
    oleafly_secrets::fsperm::harden_file(&path);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(id: &str, task: Option<&str>, at: i64, cost: f64) -> UsageSpoolEvent {
        UsageSpoolEvent {
            id: id.into(),
            source: "daemon".into(),
            task_id: task.map(str::to_owned),
            project_id: Some("p1".into()),
            project_path: None,
            provider: "openai".into(),
            model: "gpt-6.1-sol".into(),
            input_tokens: Some(10),
            output_tokens: Some(5),
            cache_read_tokens: None,
            cache_write_tokens: None,
            cost_usd: Some(cost),
            status: "completed".into(),
            at,
        }
    }

    #[test]
    fn events_round_trip_in_order() {
        let data = tempfile::tempdir().unwrap();
        append(data.path(), &event("a", Some("t1"), 10, 0.1)).unwrap();
        append(data.path(), &event("b", Some("t2"), 20, 0.2)).unwrap();
        append(data.path(), &event("c", Some("t1"), 30, 0.3)).unwrap();
        let all = read_all(data.path()).unwrap();
        assert_eq!(
            all.iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b", "c"]
        );
        let since = read_since(data.path(), "t1", 15).unwrap();
        assert_eq!(since.len(), 1);
        assert_eq!(since[0].id, "c");
        assert_eq!(
            spool_path(data.path()),
            data.path().join("daemon").join("usage-spool.jsonl")
        );
    }

    #[test]
    fn a_missing_spool_reads_as_empty_and_bad_lines_are_skipped() {
        let data = tempfile::tempdir().unwrap();
        assert!(read_all(data.path()).unwrap().is_empty());
        std::fs::create_dir_all(data.path().join("daemon")).unwrap();
        std::fs::write(spool_path(data.path()), "not json\n{\"id\":1}\n").unwrap();
        append(data.path(), &event("ok", None, 1, 0.0)).unwrap();
        assert_eq!(read_all(data.path()).unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn the_spool_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let data = tempfile::tempdir().unwrap();
        append(data.path(), &event("a", None, 1, 0.0)).unwrap();
        let mode = std::fs::metadata(spool_path(data.path()))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
    }

    #[test]
    fn event_ids_are_unique() {
        let ids: std::collections::BTreeSet<String> =
            (0..200).map(|_| event_id("cli-agent")).collect();
        assert_eq!(ids.len(), 200);
    }

    #[test]
    fn compaction_keeps_recent_events_only_when_the_spool_is_large() {
        let data = tempfile::tempdir().unwrap();
        append(data.path(), &event("old", None, 1, 0.0)).unwrap();
        assert!(!compact(data.path(), 100).unwrap());
        let filler = "x".repeat(4000);
        let mut big = event("new", None, 200, 0.0);
        big.model = filler;
        for _ in 0..2200 {
            append(data.path(), &big).unwrap();
        }
        assert!(compact(data.path(), 100).unwrap());
        let left = read_all(data.path()).unwrap();
        assert!(left.iter().all(|event| event.id == "new"));
    }

    #[test]
    fn a_data_root_with_spaces_and_accents_works() {
        let data = tempfile::tempdir().unwrap();
        let root = data.path().join("Zoë Müller data");
        append(&root, &event("a", Some("t"), 1, 0.5)).unwrap();
        assert_eq!(read_since(&root, "t", 0).unwrap()[0].cost_usd, Some(0.5));
    }
}
