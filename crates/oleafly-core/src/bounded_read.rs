use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedRead {
    pub bytes: Vec<u8>,
    pub complete: bool,
}

impl BoundedRead {
    pub fn whole(self) -> Option<Vec<u8>> {
        self.complete.then_some(self.bytes)
    }

    pub fn lossy_text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
}

pub fn read_bounded(path: &Path, limit: u64) -> Option<BoundedRead> {
    if !std::fs::metadata(path).ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .ok()?;
    let complete = bytes.len() as u64 <= limit;
    if !complete {
        bytes.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
    }
    Some(BoundedRead { bytes, complete })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_within_the_limit_is_read_whole() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a.txt");
        std::fs::write(&path, "abcd").unwrap();
        let read = read_bounded(&path, 4).unwrap();
        assert!(read.complete);
        assert_eq!(read.lossy_text(), "abcd");
        assert_eq!(read.whole(), Some(b"abcd".to_vec()));
    }

    #[test]
    fn a_longer_file_keeps_only_the_limit_and_says_so() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a.txt");
        std::fs::write(&path, "abcdef").unwrap();
        let read = read_bounded(&path, 4).unwrap();
        assert!(!read.complete);
        assert_eq!(read.bytes, b"abcd");
        assert_eq!(read.whole(), None);
    }

    #[test]
    fn folders_and_missing_files_give_nothing() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(read_bounded(directory.path(), 4), None);
        assert_eq!(read_bounded(&directory.path().join("missing"), 4), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_pipe_is_never_opened() {
        let directory = tempfile::tempdir().unwrap();
        let fifo = directory.path().join("fifo");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(read_bounded(&fifo, 4), None);
    }

    #[test]
    fn invalid_utf8_reads_as_replacement_characters() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a.bin");
        std::fs::write(&path, [b'a', 0xFF, b'b']).unwrap();
        assert_eq!(read_bounded(&path, 8).unwrap().lossy_text(), "a\u{FFFD}b");
    }
}
