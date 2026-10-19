//! The environment a TeX compile needs for the pinned Biber: the folder
//! PAR::Packer unpacks Biber into (`PAR_GLOBAL_TMPDIR`, one per Biber build,
//! named after its fingerprint) and the compile's `PATH`.
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

pub const UNPACK_ENV: &str = "PAR_GLOBAL_TMPDIR";
pub const LAST_USED_MARKER: &str = ".last-used";
/// How much of each end of a binary its fingerprint reads.
pub const FINGERPRINT_SAMPLE_BYTES: u64 = 1024 * 1024;

/// `<data>/assets/biber`.
pub fn unpack_root(data_root: &Path) -> PathBuf {
    data_root.join("assets").join("biber")
}

pub fn unpack_dir_for(data_root: &Path, biber: &Path) -> Option<PathBuf> {
    fingerprint(biber).map(|fingerprint| unpack_root(data_root).join(fingerprint))
}

/// Creates (and stamps) the unpack folder for this Biber.
pub fn prepare_unpack_dir(data_root: &Path, biber: &Path) -> Option<PathBuf> {
    let dir = unpack_dir_for(data_root, biber)?;
    std::fs::create_dir_all(&dir).ok()?;
    if !dir.is_dir() {
        return None;
    }
    let _ = stamp_last_use(&dir, std::time::SystemTime::now());
    Some(dir)
}

pub fn stamp_last_use(dir: &Path, when: std::time::SystemTime) -> std::io::Result<()> {
    std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LAST_USED_MARKER))?
        .set_modified(when)
}

/// `tectonic-biber` in `dir`, the name Tectonic looks for first.
pub fn tectonic_biber_in(dir: &Path) -> Option<PathBuf> {
    crate::sidecar::sidecar_in(dir, "tectonic-biber")
}

type FingerprintCache =
    std::collections::HashMap<PathBuf, (u64, Option<std::time::SystemTime>, String)>;

/// [`binary_fingerprint`], cached by size and modification time.
pub fn fingerprint(path: &Path) -> Option<String> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<FingerprintCache>> =
        std::sync::OnceLock::new();
    let metadata = std::fs::metadata(path).ok()?;
    let stamp = (metadata.len(), metadata.modified().ok());
    let cache = CACHE.get_or_init(Default::default);
    let lock = || {
        cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    };
    if let Some((len, modified, fingerprint)) = lock().get(path) {
        if (*len, *modified) == stamp {
            return Some(fingerprint.clone());
        }
    }
    let fingerprint = binary_fingerprint(path).ok()?;
    lock().insert(path.to_path_buf(), (stamp.0, stamp.1, fingerprint.clone()));
    Some(fingerprint)
}

/// Eight hex digits from the length and the first and last MiB of a file.
pub fn binary_fingerprint(path: &Path) -> std::io::Result<String> {
    use sha2::Digest;
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let mut hasher = sha2::Sha256::new();
    hasher.update(len.to_le_bytes());
    let head = len.min(FINGERPRINT_SAMPLE_BYTES);
    hash_file_range(&mut file, 0, head, &mut hasher)?;
    let tail_start = len.saturating_sub(FINGERPRINT_SAMPLE_BYTES).max(head);
    hash_file_range(&mut file, tail_start, len - tail_start, &mut hasher)?;
    Ok(hasher.finalize()[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn hash_file_range(
    file: &mut std::fs::File,
    start: u64,
    len: u64,
    hasher: &mut sha2::Sha256,
) -> std::io::Result<()> {
    use std::io::{Read, Seek};
    file.seek(std::io::SeekFrom::Start(start))?;
    let copied = std::io::copy(&mut file.by_ref().take(len), hasher)?;
    if copied != len {
        return Err(std::io::ErrorKind::UnexpectedEof.into());
    }
    Ok(())
}

pub fn push_unique(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

pub fn path_is_within(path: &Path, root: &Path) -> bool {
    let resolved_path = resolve_existing_part(path);
    let resolved_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    resolved_path == resolved_root || resolved_path.starts_with(&resolved_root)
}

/// `path` with its longest existing ancestor resolved, so a folder that
/// doesn't exist yet (and could be made during a build) still compares by
/// where it really is.
fn resolve_existing_part(path: &Path) -> PathBuf {
    let mut missing = Vec::new();
    let mut current = path;
    loop {
        if let Ok(real) = current.canonicalize() {
            return missing
                .iter()
                .rev()
                .fold(real, |resolved, part| resolved.join(part));
        }
        match (current.parent(), current.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name.to_os_string());
                current = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// A compile's `PATH`: the tool's own folder, then `extra_dirs` (Biber, TeX
/// folders), then the inherited entries; relative entries and anything
/// inside `excluded_root` (the project) are dropped, duplicates removed.
pub fn compile_path_env(
    preferred_dir: Option<&Path>,
    extra_dirs: &[PathBuf],
    inherited: Option<&OsStr>,
    excluded_root: Option<&Path>,
) -> OsString {
    let mut dirs = Vec::new();
    let mut add = |dir: PathBuf| {
        if dir.is_absolute() && !excluded_root.is_some_and(|root| path_is_within(&dir, root)) {
            push_unique(&mut dirs, dir);
        }
    };
    if let Some(preferred) = preferred_dir {
        add(preferred.to_path_buf());
    }
    for dir in extra_dirs {
        add(dir.clone());
    }
    if let Some(inherited) = inherited {
        for dir in std::env::split_paths(inherited) {
            add(dir);
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_biber_unpacks_into_a_folder_named_after_its_fingerprint() {
        let data = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let one = tools.path().join("biber-one");
        let two = tools.path().join("biber-two");
        std::fs::write(&one, b"first build").unwrap();
        std::fs::write(&two, b"second build").unwrap();
        let first = prepare_unpack_dir(data.path(), &one).unwrap();
        let second = prepare_unpack_dir(data.path(), &two).unwrap();
        assert_ne!(first, second);
        assert!(first.starts_with(unpack_root(data.path())));
        assert!(first.join(LAST_USED_MARKER).is_file());
        assert_eq!(binary_fingerprint(&one).unwrap().len(), 8);
    }

    #[test]
    fn compile_path_env_skips_project_dirs_and_duplicates() {
        let project = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let preferred = tools.path().join("engine");
        let extra = tools.path().join("tex");
        std::fs::create_dir_all(&preferred).unwrap();
        std::fs::create_dir_all(&extra).unwrap();
        let inherited = std::env::join_paths([
            project.path().join("bin"),
            extra.clone(),
            tools.path().join("other"),
        ])
        .unwrap();
        let value = compile_path_env(
            Some(&preferred),
            std::slice::from_ref(&extra),
            Some(&inherited),
            Some(project.path()),
        );
        let entries: Vec<PathBuf> = std::env::split_paths(&value).collect();
        assert_eq!(entries, vec![preferred, extra, tools.path().join("other")]);
    }
}
