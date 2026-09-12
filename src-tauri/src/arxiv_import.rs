//! Import an arXiv e-print (`https://export.arxiv.org/e-print/<id>`) as a new
//! project. Most e-prints are a gzipped tar of the LaTeX source; some are a
//! single gzipped file, and some papers ship no source at all (PDF only).

use std::io::Read;
use std::path::Path;

const MAX_EPRINT_BYTES: u64 = 512 * 1024 * 1024; // 512 MB download cap
const MAX_EPRINT_ENTRIES: usize = 5000;
const MAX_EPRINT_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GB unpacked

/// Accept modern (`2301.01234`, with optional `v2`) and old-style
/// (`math.GT/0309136`) ids. The whitelist also keeps paths out of the URL.
fn validate_arxiv_id(id: &str) -> Result<(), String> {
    let id = id.trim().trim_start_matches("arXiv:").trim();
    let modern = |s: &str| {
        let (base, version) = match s.split_once('v') {
            Some((b, v)) => (b, v),
            None => (s, ""),
        };
        let mut digits = base.split('.');
        let matches = digits
            .next()
            .is_some_and(|l| l.len() == 4 && l.chars().all(|c| c.is_ascii_digit()))
            && digits.next().is_some_and(|r| {
                (4..=5).contains(&r.len()) && r.chars().all(|c| c.is_ascii_digit())
            })
            && digits.next().is_none()
            && (version.is_empty() || version.chars().all(|c| c.is_ascii_digit()));
        matches
    };
    let old_style = |s: &str| {
        match s.split_once('/') {
            Some((archive, number)) => {
                // Old-style archives look like hep-ph, math.GT, cond-mat.
                !archive.is_empty()
                    && archive.len() <= 16
                    && archive
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
                    && number.len() == 7
                    && number.chars().all(|c| c.is_ascii_digit())
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
fn extract_tar_gz(bytes: &[u8], dest: &Path) -> Result<usize, String> {
    let gunzipped = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(gunzipped);
    archive.set_overwrite(false);
    let mut entries = 0usize;
    let mut total = 0u64;
    for entry in archive
        .entries()
        .map_err(|e| format!("the e-print is not a readable tar archive: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("the e-print archive is damaged: {e}"))?;
        let header = entry.header();
        let kind = header.entry_type();
        if !matches!(kind, tar::EntryType::Regular | tar::EntryType::Directory) {
            continue; // symlinks, devices, and links never belong in a project
        }
        let Some(rel) = entry
            .path()
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
        else {
            continue;
        };
        let safe = std::path::Path::new(&rel)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)));
        if !safe {
            continue; // absolute or `..` traversal: skip
        }
        if rel.is_empty() || import_skip(&rel) || rel.split('/').count() > 16 {
            continue;
        }
        entries += 1;
        if entries > MAX_EPRINT_ENTRIES {
            return Err("the e-print has too many files (> 5000)".to_string());
        }
        let out = dest.join(&rel);
        if kind == tar::EntryType::Directory {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        let size = header.size().map_err(|e| e.to_string())?;
        total = total.saturating_add(size);
        if total > MAX_EPRINT_TOTAL_BYTES {
            return Err("the e-print unpacks to more than the 2 GB import limit".to_string());
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut output = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
    }
    Ok(entries)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    std::io::Write::write_all(&mut writer, bytes).map_err(|e| e.to_string())?;
    std::io::Write::flush(&mut writer).map_err(|e| e.to_string())
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
                Err(tar_error) => {
                    // Fall back to a single gzipped .tex before giving up.
                    let mut probe = Vec::new();
                    let decodable = flate2::read::GzDecoder::new(&bytes[..])
                        .read_to_end(&mut probe)
                        .is_ok();
                    if decodable {
                        atomic_write(&staging.join("main.tex"), &probe)?;
                        Ok(1)
                    } else {
                        Err(tar_error)
                    }
                }
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
        assert!(validate_arxiv_id("2301.01234v10").is_ok());
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
}
