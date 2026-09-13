//! Import an arXiv e-print (`https://export.arxiv.org/e-print/<id>`) as a new
//! project. Most e-prints are a gzipped tar of the LaTeX source; some are a
//! single gzipped file, and some papers ship no source at all (PDF only).

use std::io::{Read, Write};
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

const MAX_EPRINT_BYTES: u64 = 512 * 1024 * 1024; // 512 MB download cap
const MAX_EPRINT_ENTRIES: usize = 5000;
const MAX_EPRINT_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GB unpacked
const MAX_AD_HOC_SOURCE_BYTES: u64 = 128 * 1024 * 1024;

/// Accept modern (`2301.01234`, with optional `v2`) and old-style
/// (`math.GT/0309136`) ids. The whitelist also keeps paths out of the URL.
fn validate_arxiv_id(id: &str) -> Result<(), String> {
    let id = id.trim().trim_start_matches("arXiv:").trim();
    let modern = |s: &str| {
        let (base, version) = match s.split_once('v') {
            Some((base, version)) => (base, Some(version)),
            None => (s, None),
        };
        let mut digits = base.split('.');
        let valid_version = match version {
            Some(version) => !version.is_empty() && version.chars().all(|c| c.is_ascii_digit()),
            None => true,
        };
        let matches = digits.next().is_some_and(|left| {
            left.len() == 4
                && left.chars().all(|character| character.is_ascii_digit())
                && left[2..]
                    .parse::<u8>()
                    .is_ok_and(|month| (1..=12).contains(&month))
        }) && digits
            .next()
            .is_some_and(|r| (4..=5).contains(&r.len()) && r.chars().all(|c| c.is_ascii_digit()))
            && digits.next().is_none()
            && valid_version;
        matches
    };
    let old_style = |s: &str| {
        match s.split_once('/') {
            Some((archive, raw_number)) => {
                // Old-style archives look like hep-ph, math.GT, cond-mat.
                let (number, version) = match raw_number.split_once('v') {
                    Some((number, version)) => (number, Some(version)),
                    None => (raw_number, None),
                };
                let valid_version = match version {
                    Some(version) => {
                        !version.is_empty() && version.chars().all(|c| c.is_ascii_digit())
                    }
                    None => true,
                };
                !archive.is_empty()
                    && archive.len() <= 16
                    && archive
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
                    && number.len() == 7
                    && number.chars().all(|c| c.is_ascii_digit())
                    && valid_version
            }
            None => false,
        }
    };
    if modern(id) || old_style(id) {
        Ok(())
    } else {
        Err("Not a valid arXiv id. Use a form like 2301.01234 or math.GT/0309136.".to_string())
    }
}

async fn download_eprint(id: &str) -> Result<Vec<u8>, String> {
    let url = format!("https://export.arxiv.org/e-print/{id}");
    let client = reqwest::Client::builder()
        .user_agent("Oleafly/0.2 (https://github.com/Oleafly/Oleafly; arXiv e-print import)")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("could not reach arXiv: {e}"))?
        .error_for_status()
        .map_err(|_| format!("arXiv has no e-print for {id}."))?;
    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download failed: {e}"))?;
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > MAX_EPRINT_BYTES {
            return Err("that e-print is larger than the 512 MB import limit".to_string());
        }
    }
    Ok(bytes)
}

fn import_skip(rel: &str) -> bool {
    rel.split('/').any(|segment| {
        ["__MACOSX", ".DS_Store", ".git", ".oleafly", "Thumbs.db"]
            .iter()
            .any(|reserved| segment.eq_ignore_ascii_case(reserved))
    })
}

/// Extract a gzipped tar e-print into `dest`, enforcing the same import
/// limits as ZIP imports. Returns the number of files written.
#[derive(Debug)]
enum TarExtractionError {
    NotTar(String),
    InvalidArchive(String),
}

fn tar_header_checksum_is_valid(header: &[u8; 512]) -> bool {
    if header.iter().all(|byte| *byte == 0) {
        return true;
    }
    let raw = &header[148..156];
    let checksum = raw
        .iter()
        .copied()
        .skip_while(|byte| *byte == b' ' || *byte == 0)
        .take_while(|byte| (b'0'..=b'7').contains(byte))
        .try_fold(0_u64, |value, byte| {
            value.checked_mul(8)?.checked_add(u64::from(byte - b'0'))
        });
    let Some(expected) = checksum else {
        return false;
    };
    let actual = header.iter().enumerate().fold(0_u64, |sum, (index, byte)| {
        sum + if (148..156).contains(&index) {
            u64::from(b' ')
        } else {
            u64::from(*byte)
        }
    });
    expected == actual
}

fn probe_tar_gzip(bytes: &[u8]) -> Result<(), TarExtractionError> {
    let mut decoder = flate2::read::GzDecoder::new(bytes);
    let mut header = [0_u8; 512];
    let mut read = 0_usize;
    while read < header.len() {
        match decoder.read(&mut header[read..]) {
            Ok(0) => break,
            Ok(count) => read += count,
            Err(error) => {
                return Err(TarExtractionError::InvalidArchive(format!(
                    "the e-print gzip stream is damaged: {error}"
                )))
            }
        }
    }
    if read < header.len() {
        return Err(TarExtractionError::NotTar(
            "the e-print is a standalone gzip source".into(),
        ));
    }
    if tar_header_checksum_is_valid(&header) {
        return Ok(());
    }
    if header[257..].starts_with(b"ustar") {
        return Err(TarExtractionError::InvalidArchive(
            "the e-print tar header has an invalid checksum".into(),
        ));
    }
    Err(TarExtractionError::NotTar(
        "the e-print is a standalone gzip source".into(),
    ))
}

impl TarExtractionError {
    fn message(self) -> String {
        match self {
            Self::NotTar(message) | Self::InvalidArchive(message) => message,
        }
    }
}

fn extract_tar_gz_limited(
    bytes: &[u8],
    dest: &Path,
    max_entries: usize,
    max_total_bytes: u64,
) -> Result<usize, TarExtractionError> {
    probe_tar_gzip(bytes)?;
    let gunzipped = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(gunzipped);
    archive.set_overwrite(false);
    let mut entries = 0usize;
    let mut files = 0usize;
    let mut total = 0u64;
    let mut seen_paths = std::collections::HashSet::new();
    for entry in archive.entries().map_err(|e| {
        TarExtractionError::NotTar(format!("the e-print is not a readable tar archive: {e}"))
    })? {
        entries += 1;
        if entries > max_entries {
            return Err(TarExtractionError::InvalidArchive(format!(
                "the e-print has too many files (> {max_entries})"
            )));
        }
        let mut entry = entry.map_err(|e| {
            TarExtractionError::InvalidArchive(format!("the e-print archive is damaged: {e}"))
        })?;
        let header = entry.header();
        let kind = header.entry_type();
        if !matches!(kind, tar::EntryType::Regular | tar::EntryType::Directory) {
            continue; // symlinks, devices, and links never belong in a project
        }
        let entry_path = entry.path().map_err(|error| {
            TarExtractionError::InvalidArchive(format!(
                "the e-print contains an invalid filename: {error}"
            ))
        })?;
        let rel = entry_path
            .to_str()
            .ok_or_else(|| {
                TarExtractionError::InvalidArchive(
                    "the e-print contains a filename that is not valid Unicode".into(),
                )
            })?
            .replace('\\', "/");
        let safe = std::path::Path::new(&rel)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)));
        if !safe {
            continue; // absolute or `..` traversal: skip
        }
        if rel.is_empty() || import_skip(&rel) || rel.split('/').count() > 16 {
            continue;
        }
        let out = dest.join(&rel);
        if !seen_paths.insert(rel.to_ascii_lowercase()) {
            return Err(TarExtractionError::InvalidArchive(format!(
                "the e-print contains the same path more than once: {rel}"
            )));
        }
        if kind == tar::EntryType::Directory {
            std::fs::create_dir_all(&out)
                .map_err(|e| TarExtractionError::InvalidArchive(e.to_string()))?;
            continue;
        }
        files += 1;
        let size = header
            .size()
            .map_err(|e| TarExtractionError::InvalidArchive(e.to_string()))?;
        total = total.saturating_add(size);
        if total > max_total_bytes {
            return Err(TarExtractionError::InvalidArchive(format!(
                "the e-print unpacks to more than the {} GB import limit",
                max_total_bytes / (1024 * 1024 * 1024)
            )));
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| TarExtractionError::InvalidArchive(e.to_string()))?;
        }
        let mut output = std::fs::File::create(&out)
            .map_err(|e| TarExtractionError::InvalidArchive(e.to_string()))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|e| TarExtractionError::InvalidArchive(e.to_string()))?;
    }
    Ok(files)
}

fn extract_tar_gz(bytes: &[u8], dest: &Path) -> Result<usize, TarExtractionError> {
    extract_tar_gz_limited(bytes, dest, MAX_EPRINT_ENTRIES, MAX_EPRINT_TOTAL_BYTES)
}

/// Write a source-only e-print without collecting its uncompressed contents
/// in memory. arXiv sometimes stores a lone `.tex` file as gzip rather than a
/// tarball, but it still has to obey the same unpacked size limit.
fn write_gzipped_source_limited(bytes: &[u8], path: &Path, limit: u64) -> Result<(), String> {
    let mut input = flate2::read::GzDecoder::new(bytes);
    let file = std::fs::File::create(path).map_err(|error| error.to_string())?;
    let mut output = std::io::BufWriter::new(file);
    let copied = std::io::copy(&mut input.by_ref().take(limit), &mut output)
        .map_err(|error| format!("the e-print source could not be unpacked: {error}"))?;
    if copied == limit {
        let mut extra = [0_u8; 1];
        if input
            .read(&mut extra)
            .map_err(|error| format!("the e-print source could not be unpacked: {error}"))?
            != 0
        {
            let mebibytes = limit / (1024 * 1024);
            return Err(format!(
                "the e-print unpacks to more than the {mebibytes} MB limit"
            ));
        }
    }
    output.flush().map_err(|error| error.to_string())
}

fn unpack_source_archive(bytes: &[u8], destination: &Path, limit: u64) -> Result<(), String> {
    if bytes.starts_with(b"%PDF") {
        return Err(
            "This e-print only contains a PDF, so there is no LaTeX source to unpack.".into(),
        );
    }
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return Err("The source is not a gzip archive.".into());
    }
    match extract_tar_gz_limited(bytes, destination, MAX_EPRINT_ENTRIES, limit) {
        Ok(0) => Err("The source archive is empty.".into()),
        Ok(_) => Ok(()),
        Err(TarExtractionError::NotTar(_)) => {
            write_gzipped_source_limited(bytes, &destination.join("main.tex"), limit)
        }
        Err(error) => Err(error.message()),
    }
}

struct SourceFile {
    path: String,
    bytes: Vec<u8>,
}

fn collect_source_files(root: &Path) -> Result<Vec<SourceFile>, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    let mut total = 0_u64;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory)
            .map_err(|error| format!("Could not inspect the source archive: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("Could not inspect the source archive: {error}"))?;
            let kind = entry
                .file_type()
                .map_err(|error| format!("Could not inspect the source archive: {error}"))?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            if files.len() >= MAX_EPRINT_ENTRIES {
                return Err("The source archive contains too many files.".into());
            }
            let entry_path = entry.path();
            let relative = entry_path
                .strip_prefix(root)
                .map_err(|_| "A source file escaped the archive.".to_string())?
                .to_str()
                .ok_or_else(|| {
                    "The source archive contains a filename that is not valid Unicode.".to_string()
                })?
                .replace('\\', "/");
            let bytes = std::fs::read(entry.path())
                .map_err(|error| format!("Could not read {relative}: {error}"))?;
            total = total.saturating_add(bytes.len() as u64);
            if total > MAX_AD_HOC_SOURCE_BYTES {
                return Err("The unpacked source is larger than the 128 MB preview limit.".into());
            }
            files.push(SourceFile {
                path: relative,
                bytes,
            });
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn main_source_index(files: &[SourceFile]) -> Option<usize> {
    files
        .iter()
        .enumerate()
        .filter(|(_, file)| file.path.to_ascii_lowercase().ends_with(".tex"))
        .max_by_key(|(_, file)| {
            let lower_path = file.path.to_ascii_lowercase();
            let source = String::from_utf8_lossy(&file.bytes).to_ascii_lowercase();
            let basename = lower_path.rsplit('/').next().unwrap_or(&lower_path);
            let depth = lower_path.matches('/').count();
            let mut score = 0_i32;
            if basename == "main.tex" {
                score += 100;
            }
            if source.contains("\\documentclass") {
                score += 50;
            }
            if source.contains("\\begin{document}") {
                score += 30;
            }
            if depth == 0 {
                score += 10;
            }
            score - i32::try_from(depth).unwrap_or(i32::MAX)
        })
        .map(|(index, _)| index)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArxivSourceRequest {
    arxiv_id: Option<String>,
    data_base64: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArxivSourceArtifact {
    path: String,
    data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArxivSourceResult {
    archive_name: String,
    main_file: String,
    main_source: String,
    files: Vec<ArxivSourceArtifact>,
}

/// Preview an arXiv source bundle without publishing a project. Supplying an
/// ID downloads the e-print; supplying gzip bytes is fully offline.
#[tauri::command]
pub async fn extract_arxiv_source(
    request: ArxivSourceRequest,
) -> Result<ArxivSourceResult, String> {
    let (archive_name, bytes) = match (request.arxiv_id, request.data_base64) {
        (Some(raw_id), None) => {
            let id = raw_id
                .trim()
                .trim_start_matches("arXiv:")
                .trim()
                .to_string();
            validate_arxiv_id(&id)?;
            let bytes = download_eprint(&id).await?;
            (format!("arxiv-{}", id.replace('/', "-")), bytes)
        }
        (None, Some(data)) => {
            let estimated = data.len().saturating_mul(3) / 4;
            if estimated > MAX_EPRINT_BYTES as usize {
                return Err("The source archive is larger than the 512 MB limit.".into());
            }
            let bytes = STANDARD
                .decode(data.trim())
                .map_err(|_| "The source archive could not be decoded.".to_string())?;
            ("arxiv-source".into(), bytes)
        }
        (Some(_), Some(_)) => {
            return Err("Enter an arXiv ID or choose an archive, not both.".into())
        }
        (None, None) => return Err("Enter an arXiv ID or choose a source archive.".into()),
    };

    tauri::async_runtime::spawn_blocking(move || {
        let directory = tempfile::tempdir()
            .map_err(|error| format!("Could not prepare the source preview: {error}"))?;
        unpack_source_archive(&bytes, directory.path(), MAX_AD_HOC_SOURCE_BYTES)?;
        let source_files = collect_source_files(directory.path())?;
        let main_index = main_source_index(&source_files)
            .ok_or_else(|| "The source archive does not contain a .tex document.".to_string())?;
        let main_file = source_files[main_index].path.clone();
        let main_source = String::from_utf8_lossy(&source_files[main_index].bytes).into_owned();
        let files = source_files
            .into_iter()
            .map(|file| ArxivSourceArtifact {
                path: file.path,
                data_base64: STANDARD.encode(file.bytes),
            })
            .collect();
        Ok(ArxivSourceResult {
            archive_name,
            main_file,
            main_source,
            files,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Download an arXiv e-print and unpack it into a new project, inferring the
/// main document the same way Overleaf ZIP imports do.
#[tauri::command]
pub async fn import_arxiv_eprint(name: Option<String>, arxiv_id: String) -> Result<String, String> {
    let id = arxiv_id
        .trim()
        .trim_start_matches("arXiv:")
        .trim()
        .to_string();
    validate_arxiv_id(&id)?;
    let fallback_name = format!("arXiv:{id}");
    let project_name = name
        .filter(|candidate| !candidate.trim().is_empty())
        .unwrap_or(fallback_name);
    let bytes = download_eprint(&id).await?;
    let unpack = move || -> Result<String, String> {
        if bytes.starts_with(b"%PDF") {
            return Err(format!(
                "arXiv only publishes a PDF for {id}, so there is no LaTeX source to import."
            ));
        }
        if !bytes.starts_with(&[0x1f, 0x8b]) {
            return Err("the e-print is not a gzip archive, so it cannot be unpacked.".into());
        }
        let root = crate::paths::projects_root()?;
        let staging =
            crate::project::create_unique_temporary_directory(&root, ".oleafly-arxiv-import")?;
        let result = (|| -> Result<usize, String> {
            match extract_tar_gz(&bytes, &staging) {
                Ok(count) => Ok(count),
                Err(TarExtractionError::NotTar(_)) => {
                    // Fall back only when the decompressed stream is not a
                    // tarball at all. A damaged tar must not be imported as
                    // text after leaving a partially extracted tree behind.
                    write_gzipped_source_limited(
                        &bytes,
                        &staging.join("main.tex"),
                        MAX_EPRINT_TOTAL_BYTES,
                    )?;
                    Ok(1)
                }
                Err(error) => Err(error.message()),
            }
        })();
        if let Err(error) = result {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
        let staging_str = staging.to_string_lossy().into_owned();
        let imported =
            crate::project::import_project_directory_blocking(Some(project_name), &staging_str);
        let _ = std::fs::remove_dir_all(&staging);
        imported
    };
    tauri::async_runtime::spawn_blocking(unpack)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arxiv_ids_are_validated_before_they_touch_a_url() {
        assert!(validate_arxiv_id("2301.01234").is_ok());
        assert!(validate_arxiv_id("arXiv:2301.01234v2").is_ok());
        assert!(validate_arxiv_id("math.GT/0309136").is_ok());
        assert!(validate_arxiv_id("hep-th/9901001v2").is_ok());
        assert!(validate_arxiv_id("2301.01234v10").is_ok());
        assert!(validate_arxiv_id("2301.01234v").is_err());
        assert!(validate_arxiv_id("hep-th/9901001v").is_err());
        assert!(validate_arxiv_id("2313.01234").is_err());
        assert!(validate_arxiv_id("../etc/passwd").is_err());
        assert!(validate_arxiv_id("2301.012").is_err());
        assert!(validate_arxiv_id("2301.012345").is_err());
        assert!(validate_arxiv_id("not-an-id").is_err());
        assert!(validate_arxiv_id("../../../e-print").is_err());
    }

    #[test]
    fn tar_extraction_skips_traversal_and_junk() {
        let dir = tempfile::tempdir().unwrap();
        let mut builder = tar::Builder::new(Vec::new());
        let add = |builder: &mut tar::Builder<Vec<u8>>, path: &str, data: &[u8]| {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, data).unwrap();
        };
        add(&mut builder, "main.tex", b"\\documentclass{article}");
        add(&mut builder, "__MACOSX/junk", b"junk");
        add(&mut builder, ".git/config", b"nope");
        {
            let mut header = tar::Header::new_gnu();
            header.set_size(0);
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_mode(0o777);
            header.set_cksum();
            builder
                .append_data(&mut header, "link.tex", std::io::empty())
                .unwrap();
        }
        let bytes = builder.into_inner().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gz, &bytes).unwrap();
        let tar_gz = gz.finish().unwrap();
        let count = extract_tar_gz(&tar_gz, dir.path()).unwrap();
        assert_eq!(count, 1);
        assert!(dir.path().join("main.tex").is_file());
        assert!(!dir.path().join("__MACOSX").exists());
        assert!(!dir.path().join("../escape.tex").exists());
    }

    #[test]
    fn tar_entry_limit_counts_skipped_entries_too() {
        let dir = tempfile::tempdir().unwrap();
        let mut builder = tar::Builder::new(Vec::new());
        for path in ["__MACOSX/junk", "main.tex"] {
            let mut header = tar::Header::new_gnu();
            header.set_size(1);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, &b"x"[..]).unwrap();
        }
        let bytes = builder.into_inner().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gz, &bytes).unwrap();
        let tar_gz = gz.finish().unwrap();

        assert!(matches!(
            extract_tar_gz_limited(&tar_gz, dir.path(), 1, MAX_EPRINT_TOTAL_BYTES),
            Err(TarExtractionError::InvalidArchive(_))
        ));
    }

    #[test]
    fn tar_extraction_rejects_case_insensitive_duplicate_paths() {
        let dir = tempfile::tempdir().unwrap();
        let mut builder = tar::Builder::new(Vec::new());
        for path in ["main.tex", "MAIN.TEX"] {
            let mut header = tar::Header::new_gnu();
            header.set_size(1);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, &b"x"[..]).unwrap();
        }
        let bytes = builder.into_inner().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gz, &bytes).unwrap();
        let tar_gz = gz.finish().unwrap();

        let error = extract_tar_gz(&tar_gz, dir.path()).unwrap_err().message();
        assert!(error.contains("same path more than once"));
    }

    #[test]
    fn standalone_gzip_is_streamed_and_size_limited() {
        let dir = tempfile::tempdir().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gz, b"abcdef").unwrap();
        let compressed = gz.finish().unwrap();
        let output = dir.path().join("main.tex");

        assert!(write_gzipped_source_limited(&compressed, &output, 5).is_err());
        write_gzipped_source_limited(&compressed, &output, 6).unwrap();
        assert_eq!(std::fs::read(&output).unwrap(), b"abcdef");
    }

    #[test]
    fn main_source_prefers_a_root_main_document() {
        let files = vec![
            SourceFile {
                path: "sections/intro.tex".into(),
                bytes: b"\\documentclass{article}\\begin{document}".to_vec(),
            },
            SourceFile {
                path: "main.tex".into(),
                bytes: b"\\documentclass{article}\\begin{document}".to_vec(),
            },
        ];
        assert_eq!(main_source_index(&files), Some(1));
    }

    fn source_archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (path, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, *data).unwrap();
        }
        let tar = builder.into_inner().unwrap();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(&tar).unwrap();
        gzip.finish().unwrap()
    }

    #[tokio::test]
    async fn saved_source_archive_is_previewed_without_network_access() {
        let archive = source_archive(&[
            ("sections/intro.tex", b"Section"),
            (
                "main.tex",
                b"\\documentclass{article}\\begin{document}Ready\\end{document}",
            ),
            ("figure.png", b"image"),
        ]);
        let result = extract_arxiv_source(ArxivSourceRequest {
            arxiv_id: None,
            data_base64: Some(STANDARD.encode(archive)),
        })
        .await
        .unwrap();
        assert_eq!(result.archive_name, "arxiv-source");
        assert_eq!(result.main_file, "main.tex");
        assert!(result.main_source.contains("Ready"));
        assert_eq!(
            result
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["figure.png", "main.tex", "sections/intro.tex"]
        );
        assert_eq!(
            STANDARD.decode(&result.files[0].data_base64).unwrap(),
            b"image"
        );
    }

    #[tokio::test]
    async fn standalone_gzip_is_previewed_as_main_tex() {
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(b"\\documentclass{article}\\begin{document}Single\\end{document}")
            .unwrap();
        let result = extract_arxiv_source(ArxivSourceRequest {
            arxiv_id: None,
            data_base64: Some(STANDARD.encode(gzip.finish().unwrap())),
        })
        .await
        .unwrap();
        assert_eq!(result.main_file, "main.tex");
        assert!(result.main_source.contains("Single"));
    }

    #[tokio::test]
    async fn source_preview_rejects_ambiguous_and_invalid_payloads() {
        for request in [
            ArxivSourceRequest {
                arxiv_id: None,
                data_base64: None,
            },
            ArxivSourceRequest {
                arxiv_id: Some("2301.01234".into()),
                data_base64: Some("H4s=".into()),
            },
            ArxivSourceRequest {
                arxiv_id: None,
                data_base64: Some("not-base64".into()),
            },
        ] {
            assert!(extract_arxiv_source(request).await.is_err());
        }
        let pdf = extract_arxiv_source(ArxivSourceRequest {
            arxiv_id: None,
            data_base64: Some(STANDARD.encode(b"%PDF-1.7")),
        })
        .await
        .err()
        .expect("PDF-only source should fail");
        assert!(pdf.contains("only contains a PDF"));
    }

    #[test]
    fn archive_preview_requires_source_and_skips_symlinks() {
        let empty = tempfile::tempdir().unwrap();
        assert!(main_source_index(&[]).is_none());
        assert!(unpack_source_archive(b"plain text", empty.path(), 1024)
            .unwrap_err()
            .contains("not a gzip"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let root = tempfile::tempdir().unwrap();
            std::fs::create_dir_all(root.path().join("nested")).unwrap();
            std::fs::write(root.path().join("nested/main.tex"), b"source").unwrap();
            std::fs::write(root.path().join("outside.tex"), b"outside").unwrap();
            symlink(
                root.path().join("outside.tex"),
                root.path().join("nested/linked.tex"),
            )
            .unwrap();
            let files = collect_source_files(root.path().join("nested").as_path()).unwrap();
            assert_eq!(files.len(), 1);
            assert_eq!(files[0].path, "main.tex");
        }
    }

    #[test]
    fn tar_probe_distinguishes_standalone_sources_from_damaged_archives() {
        let standalone = "x".repeat(1024);
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(standalone.as_bytes()).unwrap();
        assert!(matches!(
            probe_tar_gzip(&gzip.finish().unwrap()),
            Err(TarExtractionError::NotTar(_))
        ));

        let archive = source_archive(&[("main.tex", &b"source"[..])]);
        let mut decoder = flate2::read::GzDecoder::new(archive.as_slice());
        let mut tar = Vec::new();
        decoder.read_to_end(&mut tar).unwrap();
        tar[0] ^= 1;
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(&tar).unwrap();
        assert!(matches!(
            probe_tar_gzip(&gzip.finish().unwrap()),
            Err(TarExtractionError::InvalidArchive(_))
        ));
    }
}
