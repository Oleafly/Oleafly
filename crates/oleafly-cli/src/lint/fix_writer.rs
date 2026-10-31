use std::path::Path;
use std::time::SystemTime;

use oleafly_preflight::SourceText;

#[derive(Debug)]
pub enum FixError {
    Overlap,
    ChangedOnDisk,
    NotUtf8,
    Io(std::io::Error),
}

impl std::fmt::Display for FixError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Overlap => formatter.write_str("two fixes overlap"),
            Self::ChangedOnDisk => formatter.write_str("the file changed while it was checked"),
            Self::NotUtf8 => formatter.write_str("the file isn't valid UTF-8"),
            Self::Io(error) => write!(formatter, "{error}"),
        }
    }
}

pub struct LineEndingMap {
    original: Vec<usize>,
}

impl LineEndingMap {
    pub fn new(original: &str) -> (String, Self) {
        let bytes = original.as_bytes();
        let mut normalized = String::with_capacity(original.len());
        let mut map = Vec::with_capacity(original.len() + 1);
        let mut index = 0;
        let mut start = 0;
        while index < bytes.len() {
            if bytes[index] == b'\r' {
                normalized.push_str(&original[start..index]);
                map.extend(start..index);
                normalized.push('\n');
                map.push(index);
                index += if bytes.get(index + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
                start = index;
            } else {
                index += 1;
            }
        }
        normalized.push_str(&original[start..]);
        map.extend(start..bytes.len());
        map.push(bytes.len());
        (normalized, Self { original: map })
    }

    pub fn original_byte(&self, normalized_byte: usize) -> usize {
        self.original[normalized_byte.min(self.original.len() - 1)]
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileStamp {
    pub len: u64,
    pub modified: Option<SystemTime>,
}

impl FileStamp {
    pub fn of(path: &Path) -> std::io::Result<Self> {
        let metadata = std::fs::metadata(path)?;
        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
        })
    }
}

pub fn apply_fixes(
    original: &str,
    map: &LineEndingMap,
    normalized: &SourceText,
    edits: &[(usize, usize, String)],
) -> Result<String, FixError> {
    let mut sorted: Vec<&(usize, usize, String)> = edits.iter().collect();
    sorted.sort_by_key(|(from, to, _)| (*from, *to));
    for pair in sorted.windows(2) {
        if pair[1].0 < pair[0].1 {
            return Err(FixError::Overlap);
        }
    }
    let mut out = original.to_string();
    for (from, to, replacement) in sorted.into_iter().rev() {
        let start = map.original_byte(normalized.byte_at(*from));
        let end = map.original_byte(normalized.byte_at(*to));
        if start > end
            || end > out.len()
            || !out.is_char_boundary(start)
            || !out.is_char_boundary(end)
        {
            return Err(FixError::Overlap);
        }
        out.replace_range(start..end, replacement);
    }
    Ok(out)
}

pub fn write_if_unchanged(path: &Path, before: &FileStamp, bytes: &[u8]) -> Result<(), FixError> {
    let now = FileStamp::of(path).map_err(FixError::Io)?;
    if &now != before {
        return Err(FixError::ChangedOnDisk);
    }
    oleafly_core::atomic::write_atomic(path, bytes).map_err(FixError::Io)
}

pub fn without_overlaps<T>(mut edits: Vec<(usize, usize, T)>) -> Vec<(usize, usize, T)> {
    edits.sort_by_key(|(from, to, _)| (*from, *to));
    let mut kept: Vec<(usize, usize, T)> = Vec::new();
    for edit in edits {
        if kept.last().is_none_or(|last| edit.0 >= last.1) {
            kept.push(edit);
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed(original: &str, edits: &[(usize, usize, &str)]) -> String {
        let (normalized, map) = LineEndingMap::new(original);
        let source = SourceText::new(normalized);
        let edits: Vec<(usize, usize, String)> = edits
            .iter()
            .map(|(from, to, text)| (*from, *to, text.to_string()))
            .collect();
        apply_fixes(original, &map, &source, &edits).unwrap()
    }

    #[test]
    fn line_ending_map_round_trips_crlf_offsets() {
        let (normalized, map) = LineEndingMap::new("a\r\nb\r\nc");
        assert_eq!(
            (
                normalized.as_str(),
                map.original_byte(2),
                map.original_byte(4)
            ),
            ("a\nb\nc", 3, 6)
        );
    }

    #[test]
    fn crlf_files_keep_their_line_endings() {
        assert_eq!(
            fixed("We compare the the results.\r\nNext.\r\n", &[(15, 19, "")]),
            "We compare the results.\r\nNext.\r\n"
        );
    }

    #[test]
    fn bom_is_preserved_by_fixes() {
        assert_eq!(fixed("\u{feff}the the", &[(4, 8, "")]), "\u{feff}the");
    }

    #[test]
    fn overlapping_edits_are_dropped() {
        let kept = without_overlaps(vec![
            (5, 9, "a".to_string()),
            (0, 6, "b".to_string()),
            (9, 10, "c".to_string()),
        ]);
        assert_eq!(
            kept.iter().map(|edit| edit.2.as_str()).collect::<Vec<_>>(),
            ["b", "c"]
        );
        let (normalized, map) = LineEndingMap::new("0123456789");
        let source = SourceText::new(normalized);
        assert!(matches!(
            apply_fixes(
                "0123456789",
                &map,
                &source,
                &[(0, 5, String::new()), (3, 6, String::new())]
            ),
            Err(FixError::Overlap)
        ));
    }

    #[test]
    fn changed_file_is_not_overwritten() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.md");
        std::fs::write(&path, "one").unwrap();
        let stamp = FileStamp::of(&path).unwrap();
        std::fs::write(&path, "changed by someone").unwrap();
        assert!(matches!(
            write_if_unchanged(&path, &stamp, b"fixed"),
            Err(FixError::ChangedOnDisk)
        ));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "changed by someone"
        );
    }

    #[test]
    fn fixes_are_written_atomically() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.md");
        std::fs::write(&path, "the the").unwrap();
        let stamp = FileStamp::of(&path).unwrap();
        write_if_unchanged(&path, &stamp, b"the").unwrap();
        let names: Vec<String> = std::fs::read_dir(folder.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["notes.md"]);
    }
}
