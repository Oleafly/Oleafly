//! The last build's log and PDF, when they are newer than the sources.
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use oleafly_core::engine_spec::ENTRY_STEM;
use oleafly_preflight::CompileStatus;

/// Logs are read up to this many bytes, like the app.
pub const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;
/// A PDF this much older than its log means the build failed.
const PDF_LAG: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BuildArtifacts {
    pub log: Option<(PathBuf, CompileStatus)>,
    pub pdf: Option<PathBuf>,
    /// Build output exists but is older than the sources (so it was left out).
    pub stale: bool,
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .and_then(|metadata| metadata.modified().ok())
}

fn first_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

/// The build output of `build_dir` for `main_document`, kept only when it is
/// at least as new as the newest source.
pub fn discover(
    build_dir: &Path,
    main_document: &str,
    newest_source: Option<SystemTime>,
) -> BuildArtifacts {
    let stem = Path::new(main_document)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let record = crate::record::read_record(build_dir)
        .filter(|record| record.main_document == main_document);
    let log = first_file(&[
        build_dir.join(crate::record::LOG_FILE),
        build_dir.join(format!("{ENTRY_STEM}.log")),
        build_dir.join(format!("{stem}.log")),
    ]);
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
        }
    }
    if let Some(pdf) = pdf {
        if fresh(&pdf) {
            artifacts.pdf = Some(pdf);
        } else {
            artifacts.stale = true;
        }
    }
    artifacts
}

/// The start of a log (≤ 4 MiB, cut at a character), with LF line endings.
pub fn read_log_head(path: &Path) -> std::io::Result<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_LOG_BYTES)
        .read_to_end(&mut bytes)?;
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => {
            let mut bytes = error.into_bytes();
            // Drop a character the limit cut in half, then read the rest lossily.
            let valid = std::str::from_utf8(&bytes)
                .map(str::len)
                .unwrap_or_else(|error| error.valid_up_to());
            if bytes.len() - valid < 4 && std::str::from_utf8(&bytes[valid..]).is_err() {
                bytes.truncate(valid);
            }
            String::from_utf8_lossy(&bytes).into_owned()
        }
    };
    Ok(oleafly_preflight::normalize_line_endings(&text).into_owned())
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
