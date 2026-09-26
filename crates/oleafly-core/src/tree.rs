use crate::{Error, ErrorKind, Result};
use std::ffi::OsStr;
use std::path::Path;

pub const MAX_DISCOVERY_DEPTH: usize = 64;

pub const GENERATED_DIRECTORIES: [&str; 4] = [".git", ".oleafly", "node_modules", "target"];

pub fn is_generated_directory(name: &OsStr) -> bool {
    GENERATED_DIRECTORIES
        .iter()
        .any(|ignored| name == OsStr::new(ignored))
}

pub fn is_skipped_scan_directory(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "build" | "out" | "__MACOSX" | "svg-inkscape"
        )
        || name.starts_with("_minted")
        || name.starts_with("pythontex-files-")
}

const SF_DATALESS: u32 = 0x4000_0000;
const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

pub fn is_dataless_flags(flags: u32) -> bool {
    flags & SF_DATALESS != 0
}

pub fn is_placeholder_attributes(attributes: u32) -> bool {
    attributes
        & (FILE_ATTRIBUTE_OFFLINE
            | FILE_ATTRIBUTE_RECALL_ON_OPEN
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
        != 0
}

#[cfg(target_os = "macos")]
pub fn is_cloud_placeholder(metadata: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    is_dataless_flags(metadata.st_flags())
}

#[cfg(windows)]
pub fn is_cloud_placeholder(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    is_placeholder_attributes(metadata.file_attributes())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn is_cloud_placeholder(_metadata: &std::fs::Metadata) -> bool {
    false
}

pub fn slash_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn walk_source_tree(
    root: &Path,
    label: &str,
    visit: &mut dyn FnMut(&Path, &Path) -> Result<()>,
) -> Result<()> {
    walk(root, root, 0, label, visit)
}

fn walk(
    root: &Path,
    directory: &Path,
    depth: usize,
    label: &str,
    visit: &mut dyn FnMut(&Path, &Path) -> Result<()>,
) -> Result<()> {
    if depth > MAX_DISCOVERY_DEPTH {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!("{label} exceeded the maximum directory depth"),
        ));
    }
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            if !is_generated_directory(&entry.file_name()) {
                walk(root, &path, depth + 1, label, visit)?;
            }
        } else if file_type.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| Error::new(ErrorKind::UnsafePath, "source escaped the workspace"))?;
            visit(relative, &path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn walking_skips_generated_trees_and_reports_project_relative_paths() {
        let directory = TempDir::new().unwrap();
        std::fs::create_dir_all(directory.path().join("chapters")).unwrap();
        std::fs::write(directory.path().join("chapters/one.tex"), "").unwrap();
        for ignored in GENERATED_DIRECTORIES {
            std::fs::create_dir(directory.path().join(ignored)).unwrap();
            std::fs::write(directory.path().join(ignored).join("hidden.tex"), "").unwrap();
        }

        let mut seen = Vec::new();
        walk_source_tree(directory.path(), "source discovery", &mut |relative, _| {
            seen.push(slash_path(relative));
            Ok(())
        })
        .unwrap();

        assert_eq!(seen, vec!["chapters/one.tex".to_string()]);
    }

    #[test]
    fn scans_skip_dot_generated_and_dependency_directories() {
        for skipped in [
            ".git",
            ".venv",
            ".oleafly",
            "node_modules",
            "target",
            "build",
            "out",
            "__MACOSX",
            "_minted-paper",
            "pythontex-files-paper",
            "svg-inkscape",
        ] {
            assert!(is_skipped_scan_directory(OsStr::new(skipped)), "{skipped}");
        }
        for kept in ["chapters", "paper", "Build-notes", "outline", "figures"] {
            assert!(!is_skipped_scan_directory(OsStr::new(kept)), "{kept}");
        }
    }

    #[test]
    fn cloud_placeholder_bits_match_the_platform_constants() {
        assert!(is_dataless_flags(0x4000_0000));
        assert!(!is_dataless_flags(0x0000_0020));
        for attributes in [0x0000_1000, 0x0004_0000, 0x0040_0000, 0x0040_0020] {
            assert!(is_placeholder_attributes(attributes), "{attributes:#x}");
        }
        assert!(!is_placeholder_attributes(0x0000_0020));
        assert!(!is_placeholder_attributes(0x0000_0400));
    }

    #[test]
    fn a_local_file_is_not_a_cloud_placeholder() {
        let directory = TempDir::new().unwrap();
        let file = directory.path().join("main.tex");
        std::fs::write(&file, "local").unwrap();
        assert!(!is_cloud_placeholder(&std::fs::metadata(&file).unwrap()));
    }

    #[test]
    fn walking_stops_at_the_maximum_depth() {
        let directory = TempDir::new().unwrap();
        let mut nested = directory.path().to_path_buf();
        for index in 0..=MAX_DISCOVERY_DEPTH {
            nested = nested.join(format!("level{index}"));
        }
        std::fs::create_dir_all(&nested).unwrap();

        let error =
            walk_source_tree(directory.path(), "source discovery", &mut |_, _| Ok(())).unwrap_err();

        assert!(error.to_string().contains("maximum directory depth"));
    }
}
