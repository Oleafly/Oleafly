use std::io::Read;
use std::path::Path;

pub use oleafly_synctex::{
    forward, forward_hit, gunzip, infer_roots, inverse, map_source_line, normalized_path, parse,
    tag_for_file, Doc, Found, GunzipError, SynctexForwardHit, SynctexHit, SynctexLine,
    SynctexMappedLine, SynctexRect, MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES, SP_TO_BP,
};

use crate::DocError;

pub fn read_synctex(build_dir: &Path) -> Result<String, DocError> {
    read_synctex_limited(build_dir, MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES)
}

fn read_synctex_limited(
    build_dir: &Path,
    max_file_bytes: u64,
    max_text_bytes: u64,
) -> Result<String, DocError> {
    let path = build_dir.join(format!(
        "{}.synctex.gz",
        oleafly_core::engine_spec::ENTRY_STEM
    ));
    let opened = std::fs::symlink_metadata(&path).and_then(|metadata| {
        if metadata.is_file() {
            std::fs::File::open(&path)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "it isn't a regular file",
            ))
        }
    });
    let file = match opened {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(DocError::new(
                "synctex.not_compiled",
                "This project hasn't been compiled with SyncTeX yet.",
            ));
        }
        Err(error) => {
            return Err(DocError::other(format!(
                "failed to read synctex {path:?}: {error}"
            )))
        }
    };
    let read_error = |error: std::io::Error| {
        DocError::other(format!("failed to read synctex {path:?}: {error}"))
    };
    let length = file.metadata().map_err(read_error)?.len();
    if length > max_file_bytes {
        return Err(DocError::other(GunzipError::FileTooLarge.to_string()));
    }
    let mut bytes = Vec::with_capacity(usize::try_from(length).unwrap_or_default());
    file.take(max_file_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(read_error)?;
    gunzip(&bytes, max_file_bytes, max_text_bytes)
        .map_err(|error| DocError::other(error.to_string()))
}

/// The project folder as SyncTeX may spell it (as given, and resolved).
pub fn project_roots(root: &Path) -> Vec<String> {
    let mut roots = vec![normalized_path(&root.to_string_lossy())];
    if let Ok(canonical) = root.canonicalize() {
        let canonical = normalized_path(&canonical.to_string_lossy());
        if !roots.contains(&canonical) {
            roots.push(canonical);
        }
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        use flate2::{write::GzEncoder, Compression};
        use std::io::Write;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn synctex_file(build: &Path) -> std::path::PathBuf {
        build.join("_oleafly_entry.synctex.gz")
    }

    #[test]
    fn read_synctex_unzips_a_file_within_the_limits() {
        let build = tempfile::tempdir().unwrap();
        std::fs::write(synctex_file(build.path()), gzip(b"SyncTeX Version:1\n")).unwrap();
        assert_eq!(read_synctex(build.path()).unwrap(), "SyncTeX Version:1\n");
    }

    #[test]
    fn read_synctex_stops_at_a_gzip_bomb_and_an_oversized_file() {
        let build = tempfile::tempdir().unwrap();
        let bomb = gzip(&vec![0_u8; 1 << 20]);
        assert!(bomb.len() < 64 * 1024, "{}", bomb.len());
        std::fs::write(synctex_file(build.path()), &bomb).unwrap();
        let error = read_synctex_limited(build.path(), 1 << 20, 64 * 1024).unwrap_err();
        assert!(error.message.contains("its text"), "{error}");
        assert_eq!(
            read_synctex_limited(build.path(), 1 << 20, 1 << 20)
                .unwrap()
                .len(),
            1 << 20
        );
        let error = read_synctex_limited(build.path(), 1024, 1 << 30).unwrap_err();
        assert!(error.message.contains("the file"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn read_synctex_does_not_read_through_a_link() {
        let build = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let real = elsewhere.path().join("other.synctex.gz");
        std::fs::write(&real, gzip(b"SyncTeX Version:1\n")).unwrap();
        std::os::unix::fs::symlink(&real, synctex_file(build.path())).unwrap();
        let error = read_synctex(build.path()).unwrap_err();
        assert_eq!(error.code, "doc.failed");
        assert!(error.message.contains("regular file"), "{error}");
    }

    #[test]
    fn read_synctex_names_a_missing_file_and_creates_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let build = directory.path().join("build");
        let error = read_synctex(&build).unwrap_err();
        assert_eq!(error.code, "synctex.not_compiled");
        assert!(!build.exists());
    }
}
