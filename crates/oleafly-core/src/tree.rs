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
