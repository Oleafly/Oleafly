use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use oleafly_core::engine_spec::ENTRY_STEM;
use oleafly_preflight::CompileStatus;

pub const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;
const PDF_LAG: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BuildArtifacts {
    pub log: Option<(PathBuf, CompileStatus)>,
    pub pdf: Option<PathBuf>,
    pub stale: bool,
    pub log_stale: bool,
    pub pdf_stale: bool,
    pub other_document: Option<String>,
}

/// A margin for file systems that round times (as `record::latest_log`).
const RECORD_MARGIN: Duration = Duration::from_secs(2);

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::symlink_metadata(path)
        .ok()
        .filter(std::fs::Metadata::is_file)
        .and_then(|metadata| metadata.modified().ok())
}

fn first_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|path| std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file()))
        .cloned()
}

pub fn discover(
    build_dir: &Path,
    main_document: &str,
    newest_source: Option<SystemTime>,
) -> BuildArtifacts {
    let stem = Path::new(main_document)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let engine_log = build_dir.join(format!("{ENTRY_STEM}.log"));
    let engine_time = [
        modified(&engine_log),
        modified(&build_dir.join(format!("{ENTRY_STEM}.pdf"))),
    ]
    .into_iter()
    .flatten()
    .max();
    let record = crate::record::read_record(build_dir).filter(|record| {
        let finished = SystemTime::UNIX_EPOCH + Duration::from_millis(record.finished_at_ms);
        engine_time.is_none_or(|time| time <= finished + RECORD_MARGIN)
    });
    if let Some(other) = record
        .as_ref()
        .filter(|record| record.main_document != main_document)
    {
        return BuildArtifacts {
            other_document: Some(other.main_document.clone()),
            ..BuildArtifacts::default()
        };
    }
    let log = match &record {
        Some(_) => first_file(&[build_dir.join(crate::record::LOG_FILE), engine_log]),
        None => first_file(&[engine_log, build_dir.join(format!("{stem}.log"))]),
    };
    let pdf = first_file(&[
        build_dir.join(format!("{ENTRY_STEM}.pdf")),
        build_dir.join(format!("{stem}.pdf")),
    ]);
    let fresh = |path: &Path| match (modified(path), newest_source) {
        (Some(at), Some(newest)) => at >= newest,
        (Some(_), None) => true,
        (None, _) => false,
    };
    let mut artifacts = BuildArtifacts::default();
    if let Some(log) = log {
        if fresh(&log) {
            let status = match &record {
                Some(record) if record.ok => CompileStatus::Success,
                Some(_) => CompileStatus::Error,
                None => {
                    let log_at = modified(&log);
                    let pdf_at = pdf.as_deref().and_then(modified);
                    match (log_at, pdf_at) {
                        (Some(log_at), Some(pdf_at)) if pdf_at + PDF_LAG >= log_at => {
                            CompileStatus::Success
                        }
                        _ => CompileStatus::Error,
                    }
                }
            };
            artifacts.log = Some((log, status));
        } else {
            artifacts.stale = true;
            artifacts.log_stale = true;
        }
    }
    if let Some(pdf) = pdf {
        if fresh(&pdf) {
            artifacts.pdf = Some(pdf);
        } else {
            artifacts.stale = true;
            artifacts.pdf_stale = true;
        }
    }
    artifacts
}

pub fn read_log_head(path: &Path) -> std::io::Result<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_LOG_BYTES)
        .read_to_end(&mut bytes)?;
    Ok(log_text(bytes))
}

/// The end of a log longer than [`MAX_LOG_BYTES`]: its last 4 MiB (from a
/// character), where TeX writes its fatal errors. `None` for a log the head
/// already holds whole.
pub fn read_log_tail(path: &Path) -> std::io::Result<Option<String>> {
    use std::io::{Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let length = file.metadata()?.len();
    if length <= MAX_LOG_BYTES {
        return Ok(None);
    }
    let start = length.saturating_sub(MAX_LOG_BYTES).max(MAX_LOG_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(MAX_LOG_BYTES).read_to_end(&mut bytes)?;
    let skip = bytes
        .iter()
        .take(3)
        .take_while(|byte| (**byte & 0xC0) == 0x80)
        .count();
    bytes.drain(..skip);
    Ok(Some(log_text(bytes)))
}

fn log_text(bytes: Vec<u8>) -> String {
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => {
            let mut bytes = error.into_bytes();
            let valid = std::str::from_utf8(&bytes)
                .map(str::len)
                .unwrap_or_else(|error| error.valid_up_to());
            if bytes.len() - valid < 4 && std::str::from_utf8(&bytes[valid..]).is_err() {
                bytes.truncate(valid);
            }
            String::from_utf8_lossy(&bytes).into_owned()
        }
    };
    oleafly_preflight::normalize_line_endings(&text).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path, at: SystemTime) {
        std::fs::write(path, "x").unwrap();
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_modified(at).unwrap();
    }

    #[test]
    fn stale_build_output_is_ignored_with_a_warning() {
        let build = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        touch(
            &build.path().join(format!("{ENTRY_STEM}.log")),
            now - Duration::from_secs(60),
        );
        let artifacts = discover(build.path(), "main.tex", Some(now));
        assert_eq!(artifacts.log, None);
        assert!(artifacts.stale);
    }

    #[test]
    fn failed_build_is_inferred_when_the_pdf_is_older_than_the_log() {
        let build = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        touch(&build.path().join(format!("{ENTRY_STEM}.log")), now);
        touch(
            &build.path().join(format!("{ENTRY_STEM}.pdf")),
            now - Duration::from_secs(30),
        );
        let artifacts = discover(build.path(), "main.tex", None);
        assert_eq!(artifacts.log.unwrap().1, CompileStatus::Error);
        touch(&build.path().join(format!("{ENTRY_STEM}.pdf")), now);
        assert_eq!(
            discover(build.path(), "main.tex", None).log.unwrap().1,
            CompileStatus::Success
        );
    }

    fn record(build: &Path, main: &str, finished: SystemTime) {
        let record = crate::record::BuildRecord {
            schema_version: crate::record::RECORD_SCHEMA,
            version: "0.4.8".into(),
            engine: oleafly_core::Engine::Tectonic,
            main_document: main.into(),
            ok: false,
            finished_at_ms: finished
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            compile_time_ms: 1,
            output_id: None,
            errors: Vec::new(),
            diagnostics: Vec::new(),
        };
        crate::record::write_record(build, &record, "failed\n").unwrap();
    }

    #[test]
    fn a_newer_app_build_wins_over_the_clis_older_log() {
        let build = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        record(build.path(), "main.tex", now - Duration::from_secs(600));
        touch(
            &build.path().join(crate::record::LOG_FILE),
            now - Duration::from_secs(600),
        );
        touch(&build.path().join(format!("{ENTRY_STEM}.log")), now);
        touch(&build.path().join(format!("{ENTRY_STEM}.pdf")), now);
        let found = discover(
            build.path(),
            "main.tex",
            Some(now - Duration::from_secs(60)),
        );
        let (log, status) = found.log.expect("the app's log is checked");
        assert_eq!(log, build.path().join(format!("{ENTRY_STEM}.log")));
        assert_eq!(status, CompileStatus::Success);
        assert!(!found.stale);
    }

    #[test]
    fn another_documents_build_is_left_out() {
        let build = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        record(build.path(), "slides.tex", now);
        touch(&build.path().join(format!("{ENTRY_STEM}.log")), now);
        touch(&build.path().join(format!("{ENTRY_STEM}.pdf")), now);
        let found = discover(build.path(), "main.tex", None);
        assert_eq!(
            (found.log, found.pdf, found.other_document.as_deref()),
            (None, None, Some("slides.tex"))
        );
    }

    #[test]
    fn the_end_of_a_long_log_is_read_too() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("big.log");
        let mut bytes = vec![b'a'; MAX_LOG_BYTES as usize + 1024];
        bytes.extend("\n! Emergency stop.\n".as_bytes());
        std::fs::write(&path, &bytes).unwrap();
        assert!(!read_log_head(&path).unwrap().contains("Emergency stop"));
        assert!(read_log_tail(&path)
            .unwrap()
            .unwrap()
            .contains("! Emergency stop."));
        let small = folder.path().join("small.log");
        std::fs::write(&small, "short\n").unwrap();
        assert_eq!(read_log_tail(&small).unwrap(), None);
    }

    #[test]
    fn build_log_is_read_up_to_four_mebibytes() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("big.log");
        let mut bytes = vec![b'a'; MAX_LOG_BYTES as usize - 1];
        bytes.extend("é\r\nend".as_bytes());
        bytes.extend(vec![b'b'; 1024 * 1024]);
        std::fs::write(&path, &bytes).unwrap();
        let text = read_log_head(&path).unwrap();
        assert!(text.len() as u64 <= MAX_LOG_BYTES);
        assert!(text.chars().all(|character| character == 'a'));
    }
}
