use std::path::{Path, PathBuf};

use oleafly_lint::{format_for_path, is_bibtex_source_path, is_latex_source_path};

use crate::contract::{CliError, ErrorKind};

pub(crate) const MAX_DEPTH: usize = 64;
pub(crate) const MAX_FILES: usize = 20_000;

pub fn lintable(path: &str) -> bool {
    is_latex_source_path(path) || is_bibtex_source_path(path) || format_for_path(path).is_some()
}

fn slash(relative: &Path) -> Option<String> {
    let parts: Option<Vec<&str>> = relative
        .components()
        .map(|component| match component {
            std::path::Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect();
    parts
        .filter(|parts| !parts.is_empty())
        .map(|parts| parts.join("/"))
}

fn skipped_folder(name: &str, top: bool) -> bool {
    oleafly_core::exclude::is_scan_skipped_directory(name)
        || matches!(name, ".git" | ".oleafly")
        || (top && name == oleafly_doctools::stats::VENDOR_DIR)
}

fn walk(root: &Path, folder: &Path, depth: usize, out: &mut Vec<String>, cut: &mut bool) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        *cut = true;
        return;
    }
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if kind.is_dir() {
            if !skipped_folder(&name, folder == root) {
                walk(root, &path, depth + 1, out, cut);
            }
        } else if kind.is_file() {
            if let Some(relative) = path.strip_prefix(root).ok().and_then(slash) {
                if lintable(&relative) {
                    if out.len() >= MAX_FILES {
                        *cut = true;
                        return;
                    }
                    out.push(relative);
                }
            }
        }
    }
}

pub fn lint_targets(
    root: &Path,
    requested: &[PathBuf],
    cwd: &Path,
) -> Result<(Vec<String>, bool), CliError> {
    let root = dunce::canonicalize(root).map_err(CliError::from)?;
    let mut out = Vec::new();
    let mut cut = false;
    if requested.is_empty() {
        walk(&root, &root, 0, &mut out, &mut cut);
    }
    for path in requested {
        let absolute = if path.is_absolute() {
            path.clone()
        } else if cwd.join(path).exists() {
            cwd.join(path)
        } else {
            root.join(path)
        };
        let resolved = dunce::canonicalize(&absolute).map_err(|_| {
            CliError::new(
                ErrorKind::InvalidInput,
                "project.invalid_input",
                format!("{} doesn't exist.", path.display()),
            )
        })?;
        if !resolved.starts_with(&root) {
            return Err(CliError::new(
                ErrorKind::UnsafePath,
                "project.unsafe_path",
                format!("{} isn't inside the project.", path.display()),
            ));
        }
        if resolved.is_dir() {
            walk(&root, &resolved, 0, &mut out, &mut cut);
        } else if let Some(relative) = resolved.strip_prefix(&root).ok().and_then(slash) {
            out.push(relative);
        }
    }
    out.sort();
    out.dedup();
    Ok((out, cut))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_walk_skips_dependency_and_vendored_folders() {
        let root = tempfile::tempdir().unwrap();
        for file in [
            "main.tex",
            "refs.bib",
            "notes.md",
            "node_modules/a.md",
            "typst-packages/x.typ",
            ".venv/b.tex",
            "data.csv",
            "chapters/one.typ",
        ] {
            let path = root.path().join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x").unwrap();
        }
        let (targets, cut) = lint_targets(root.path(), &[], root.path()).unwrap();
        assert!(!cut);
        assert_eq!(
            targets,
            ["chapters/one.typ", "main.tex", "notes.md", "refs.bib"]
        );
    }

    #[test]
    fn explicit_paths_outside_the_project_are_refused() {
        let place = tempfile::tempdir().unwrap();
        let root = place.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(place.path().join("other.tex"), "x").unwrap();
        std::fs::write(root.join("main.tex"), "x").unwrap();
        let error = lint_targets(&root, &[PathBuf::from("../other.tex")], &root).unwrap_err();
        assert_eq!(error.code, "project.unsafe_path");
        assert_eq!(
            lint_targets(&root, &[PathBuf::from("main.tex")], &root)
                .unwrap()
                .0,
            ["main.tex"]
        );
    }

    #[test]
    fn a_relative_path_is_found_from_the_project_root_too() {
        let place = tempfile::tempdir().unwrap();
        let root = place.path().join("thesis");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join("chapters/a.tex"), "x").unwrap();
        let (targets, _) =
            lint_targets(&root, &[PathBuf::from("chapters/a.tex")], place.path()).unwrap();
        assert_eq!(targets, ["chapters/a.tex"]);
    }

    #[test]
    fn a_walk_past_the_file_limit_says_it_was_cut() {
        let root = tempfile::tempdir().unwrap();
        let mut out = Vec::new();
        let mut cut = false;
        for index in 0..3 {
            std::fs::write(root.path().join(format!("f{index}.tex")), "x").unwrap();
        }
        out.resize(MAX_FILES - 1, String::new());
        walk(root.path(), root.path(), 0, &mut out, &mut cut);
        assert_eq!(out.len(), MAX_FILES);
        assert!(cut);
    }
}
