//! Persistent compile fingerprint (the on-disk record behind skip-recompile).
//!
//! After every successful compile the backend records what that compile was
//! built from: the main document, engine, output identity, and a content hash
//! of every source file. Reopening a project validates the record by
//! re-hashing the sources; when nothing changed, the frontend seeds the
//! preview from the already-built PDF instead of compiling again.
//!
//! Domain language: this is the "compile fingerprint" — never "checkpoint",
//! which is reserved for agent restore points.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const FINGERPRINT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileFingerprint {
    pub version: u32,
    pub main_document: String,
    pub engine_id: String,
    pub output_id: String,
    pub output_revision: u64,
    pub compiled_at_ms: u64,
    /// Relative slash path -> sha256 hex of every project source file.
    pub sources: BTreeMap<String, String>,
}

pub fn fingerprint_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".oleafly")
        .join("build")
        .join("fingerprint.json")
}

/// Hash every project source file (excluding `.oleafly` and `.git`).
pub fn source_hashes(project_root: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut hashes = BTreeMap::new();
    collect_hashes(project_root, project_root, &mut hashes)?;
    Ok(hashes)
}

fn collect_hashes(
    root: &Path,
    dir: &Path,
    out: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".oleafly" || name == ".git" {
            continue;
        }
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            collect_hashes(root, &path, out)?;
        } else {
            let relative = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .map(|component| component.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            out.insert(relative, stream_sha256(&path)?);
        }
    }
    Ok(())
}

pub fn write_fingerprint(
    project_root: &Path,
    fingerprint: &CompileFingerprint,
) -> Result<(), String> {
    let path = fingerprint_path(project_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(fingerprint).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Load the stored fingerprint and re-hash current sources. Returns the
/// fingerprint only when the record exists, matches the current main
/// document and engine, and every source hash is unchanged.
pub fn validate_fingerprint(
    project_root: &Path,
    current_main_document: &str,
    current_engine_id: &str,
) -> Option<CompileFingerprint> {
    let bytes = std::fs::read(fingerprint_path(project_root)).ok()?;
    let fingerprint: CompileFingerprint = serde_json::from_slice(&bytes).ok()?;
    if fingerprint.version != FINGERPRINT_VERSION
        || fingerprint.main_document != current_main_document
        || fingerprint.engine_id != current_engine_id
    {
        return None;
    }
    let current = source_hashes(project_root).ok()?;
    if current != fingerprint.sources {
        return None;
    }
    Some(fingerprint)
}

fn stream_sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("oleafly-fp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sections")).unwrap();
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::write(root.join("sections/intro.tex"), "intro").unwrap();
        root
    }

    fn record(root: &Path) -> CompileFingerprint {
        CompileFingerprint {
            version: FINGERPRINT_VERSION,
            main_document: "main.tex".into(),
            engine_id: "latex".into(),
            output_id: "pdf-v1:10:abc".into(),
            output_revision: 4,
            compiled_at_ms: 1_000,
            sources: source_hashes(root).unwrap(),
        }
    }

    #[test]
    fn a_written_fingerprint_validates_while_sources_are_unchanged() {
        let root = test_root("roundtrip");
        write_fingerprint(&root, &record(&root)).unwrap();

        let validated = validate_fingerprint(&root, "main.tex", "latex").unwrap();

        assert_eq!(validated.output_id, "pdf-v1:10:abc");
        assert_eq!(validated.output_revision, 4);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_edited_source_invalidates_the_fingerprint() {
        let root = test_root("edited");
        write_fingerprint(&root, &record(&root)).unwrap();

        std::fs::write(root.join("sections/intro.tex"), "intro edited").unwrap();

        assert!(validate_fingerprint(&root, "main.tex", "latex").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_added_source_invalidates_the_fingerprint() {
        let root = test_root("added");
        write_fingerprint(&root, &record(&root)).unwrap();

        std::fs::write(root.join("new.tex"), "new file").unwrap();

        assert!(validate_fingerprint(&root, "main.tex", "latex").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_removed_source_invalidates_the_fingerprint() {
        let root = test_root("removed");
        write_fingerprint(&root, &record(&root)).unwrap();

        std::fs::remove_file(root.join("sections/intro.tex")).unwrap();

        assert!(validate_fingerprint(&root, "main.tex", "latex").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_different_main_document_or_engine_invalidates_the_fingerprint() {
        let root = test_root("identity");
        write_fingerprint(&root, &record(&root)).unwrap();

        assert!(validate_fingerprint(&root, "other.tex", "latex").is_none());
        assert!(validate_fingerprint(&root, "main.tex", "typst").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn build_artifacts_and_git_internals_do_not_affect_the_fingerprint() {
        let root = test_root("internals");
        write_fingerprint(&root, &record(&root)).unwrap();

        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref").unwrap();
        std::fs::write(
            root.join(".oleafly").join("build").join("document.pdf"),
            "pdf bytes",
        )
        .unwrap();

        assert!(validate_fingerprint(&root, "main.tex", "latex").is_some());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_record_validates_as_none() {
        let root = test_root("missing");

        assert!(validate_fingerprint(&root, "main.tex", "latex").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
