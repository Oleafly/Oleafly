use std::fs::Metadata;

pub const LARGE_FILE_BYTES: u64 = 25 * 1024 * 1024;

/// Names left out without a word: Oleafly's own files and temp names, OS
/// metadata (`.DS_Store`, `._*`, `Thumbs.db`) and `.git`.
pub fn is_left_out_quietly(name: &str) -> bool {
    crate::exclude::is_oleafly_owned_name(name)
        || crate::exclude::is_os_metadata_name(name)
        || name.eq_ignore_ascii_case(".git")
}

pub fn is_skipped_directory(name: &str) -> bool {
    crate::exclude::is_linked_skipped_directory(name)
}

pub fn is_never_read(metadata: &Metadata) -> bool {
    metadata.file_type().is_symlink()
        || is_reparse_point(metadata)
        || crate::is_cloud_placeholder(metadata)
}

pub fn is_large(bytes: u64) -> bool {
    bytes > LARGE_FILE_BYTES
}

/// Whether an entry is a Windows reparse point (a junction, a mount point,
/// or a cloud file), which a capture never opens. Always false elsewhere.
#[cfg(windows)]
pub fn is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
pub fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_metadata_oleafly_names_and_git_are_left_out() {
        for name in [".DS_Store", "._main.tex", "Thumbs.db", ".git", ".oleafly"] {
            assert!(is_left_out_quietly(name), "{name}");
        }
        assert!(!is_left_out_quietly("main.tex"));
        assert!(is_skipped_directory("build") && is_skipped_directory(".cache"));
        assert!(is_large(LARGE_FILE_BYTES + 1) && !is_large(LARGE_FILE_BYTES));
    }

    #[cfg(unix)]
    #[test]
    fn links_are_never_read() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("a"), "x").unwrap();
        std::os::unix::fs::symlink(folder.path().join("a"), folder.path().join("b")).unwrap();
        let link = std::fs::symlink_metadata(folder.path().join("b")).unwrap();
        let file = std::fs::symlink_metadata(folder.path().join("a")).unwrap();
        assert!(is_never_read(&link) && !is_never_read(&file));
    }
}
