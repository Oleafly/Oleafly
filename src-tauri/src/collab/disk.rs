use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use oleafly_collab::materialize::Layout;
use oleafly_collab::{write_atomic, CollabError};
use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};

pub const MAX_SCAN_DEPTH: usize = 32;
const ALWAYS_EXCLUDED: [&str; 3] = [".oleafly", ".git", ".DS_Store"];
const ROOT_EXCLUDED: [&str; 1] = ["project.json"];

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiskState {
    pub layout: Layout,
    pub hashes: BTreeMap<String, String>,
}

impl DiskState {
    pub fn load(path: &Path) -> DiskState {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), CollabError> {
        let json =
            serde_json::to_vec(self).map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(path, &json)
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn as_text(bytes: &[u8]) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    std::str::from_utf8(bytes)
        .ok()
        .map(|text| text.replace("\r\n", "\n"))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct IgnoreRule {
    pattern: String,
    anchored: bool,
    dir_only: bool,
}

fn parse_gitignore(text: &str) -> Vec<IgnoreRule> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with('!'))
        .map(|line| {
            let dir_only = line.ends_with('/');
            let trimmed = line.trim_end_matches('/');
            let anchored = trimmed.starts_with('/') || trimmed.contains('/');
            IgnoreRule {
                pattern: trimmed.trim_start_matches('/').to_owned(),
                anchored,
                dir_only,
            }
        })
        .filter(|rule| !rule.pattern.is_empty())
        .collect()
}

fn glob(pattern: &[u8], text: &[u8]) -> bool {
    match (pattern.first(), text.first()) {
        (None, None) => true,
        (Some(b'*'), _) if pattern.get(1) == Some(&b'*') => {
            let rest = pattern[2..].strip_prefix(b"/").unwrap_or(&pattern[2..]);
            (0..=text.len()).any(|skip| glob(rest, &text[skip..]))
        }
        (Some(b'*'), _) => (0..=text.len())
            .take_while(|skip| *skip == 0 || text[skip - 1] != b'/')
            .any(|skip| glob(&pattern[1..], &text[skip..])),
        (Some(b'?'), Some(character)) if *character != b'/' => glob(&pattern[1..], &text[1..]),
        (Some(expected), Some(actual)) if expected == actual => glob(&pattern[1..], &text[1..]),
        _ => false,
    }
}

fn ignored(rules: &[IgnoreRule], relative: &str, is_dir: bool) -> bool {
    let name = relative.rsplit('/').next().unwrap_or(relative);
    rules.iter().any(|rule| {
        if rule.dir_only && !is_dir {
            return false;
        }
        if rule.anchored {
            glob(rule.pattern.as_bytes(), relative.as_bytes())
        } else {
            glob(rule.pattern.as_bytes(), name.as_bytes())
        }
    })
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Scan {
    pub files: Vec<(String, u64)>,
    pub dirs: Vec<String>,
    pub excluded: Vec<String>,
}

pub fn excluded_name(relative: &str) -> bool {
    let mut parts = relative.split('/');
    let first = parts.next().unwrap_or_default();
    if ROOT_EXCLUDED.contains(&first) && !relative.contains('/') {
        return true;
    }
    relative
        .split('/')
        .any(|part| ALWAYS_EXCLUDED.contains(&part))
}

pub fn scan_folder(root: &Path) -> Result<Scan, String> {
    let rules = std::fs::read_to_string(root.join(".gitignore"))
        .map(|text| parse_gitignore(&text))
        .unwrap_or_default();
    let mut scan = Scan::default();
    walk(root, "", &rules, &mut scan, 0)?;
    scan.files.sort();
    scan.dirs.sort();
    scan.excluded.sort();
    Ok(scan)
}

fn walk(
    root: &Path,
    relative: &str,
    rules: &[IgnoreRule],
    scan: &mut Scan,
    depth: usize,
) -> Result<(), String> {
    if depth >= MAX_SCAN_DEPTH {
        return Ok(());
    }
    let directory = if relative.is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let mut entries: Vec<_> = std::fs::read_dir(&directory)
        .map_err(|error| format!("could not read {}: {error}", directory.display()))?
        .filter_map(Result::ok)
        .collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let child = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            scan.excluded.push(child);
            continue;
        }
        if excluded_name(&child) {
            if name != ".DS_Store" {
                scan.excluded.push(if kind.is_dir() {
                    format!("{child}/")
                } else {
                    child
                });
            }
            continue;
        }
        if ignored(rules, &child, kind.is_dir()) {
            scan.excluded.push(if kind.is_dir() {
                format!("{child}/")
            } else {
                child
            });
            continue;
        }
        if kind.is_dir() {
            scan.dirs.push(child.clone());
            walk(root, &child, rules, scan, depth + 1)?;
        } else if kind.is_file() {
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            scan.files.push((child, size));
        }
    }
    Ok(())
}

pub fn safe_target(root: &Path, relative: &str) -> Option<PathBuf> {
    if relative.is_empty() || excluded_name(relative) {
        return None;
    }
    let mut target = root.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => {
                target.push(part);
                if std::fs::symlink_metadata(&target)
                    .is_ok_and(|metadata| metadata.file_type().is_symlink())
                {
                    return None;
                }
            }
            _ => return None,
        }
    }
    Some(target)
}

pub fn write_file(root: &Path, relative: &str, bytes: &[u8]) -> Result<bool, String> {
    let target =
        safe_target(root, relative).ok_or_else(|| format!("refused to write {relative}"))?;
    if std::fs::read(&target).is_ok_and(|current| current == bytes) {
        return Ok(false);
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    crate::sandbox::atomic_write(&target, bytes)?;
    crate::folder_watch::note_own_write(&target);
    Ok(true)
}

pub fn remove_path(root: &Path, relative: &str) {
    let Some(target) = safe_target(root, relative) else {
        return;
    };
    match std::fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_dir() => {
            let _ = std::fs::remove_dir(&target);
        }
        Ok(_) => {
            if std::fs::remove_file(&target).is_ok() {
                crate::folder_watch::note_own_removal(&target);
            }
        }
        Err(_) => {}
    }
}

pub fn move_path(root: &Path, from: &str, to: &str) {
    let (Some(source), Some(target)) = (safe_target(root, from), safe_target(root, to)) else {
        return;
    };
    if !source.exists() || target.exists() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::rename(&source, &target).is_ok() {
        crate::folder_watch::note_own_removal(&source);
        crate::folder_watch::note_own_write(&target);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, text: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn a_scan_leaves_out_app_state_git_and_gitignored_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "main.tex", "x");
        write(root, "chapters/intro.tex", "y");
        write(root, "project.json", "{}");
        write(root, ".oleafly/build/main.pdf", "pdf");
        write(root, ".git/HEAD", "ref");
        write(
            root,
            ".gitignore",
            "*.aux\n/out/\n# note\n!keep.aux\nbuild/\n",
        );
        write(root, "main.aux", "aux");
        write(root, "chapters/intro.aux", "aux");
        write(root, "out/main.pdf", "pdf");
        write(root, "chapters/build/x.tex", "x");
        let scan = scan_folder(root).unwrap();
        let files: Vec<&str> = scan.files.iter().map(|(path, _)| path.as_str()).collect();
        assert_eq!(files, vec![".gitignore", "chapters/intro.tex", "main.tex"]);
        assert_eq!(scan.dirs, vec!["chapters".to_owned()]);
        for left_out in [
            ".git/",
            ".oleafly/",
            "project.json",
            "main.aux",
            "chapters/intro.aux",
            "out/",
            "chapters/build/",
        ] {
            assert!(
                scan.excluded.iter().any(|path| path == left_out),
                "{left_out} in {:?}",
                scan.excluded
            );
        }
    }

    #[test]
    fn globs_match_names_and_anchored_paths() {
        assert!(glob(b"*.aux", b"main.aux"));
        assert!(!glob(b"*.aux", b"dir/main.aux"));
        assert!(glob(b"figs/*.png", b"figs/a.png"));
        assert!(glob(b"**/tmp", b"a/b/tmp"));
        assert!(glob(b"ma?n.tex", b"main.tex"));
        assert!(!glob(b"ma?n.tex", b"maiin.tex"));
    }

    #[test]
    fn text_is_recognised_and_line_endings_normalised() {
        assert_eq!(as_text(b"a\r\nb").as_deref(), Some("a\nb"));
        assert_eq!(as_text(b"\x89PNG\0"), None);
        assert_eq!(as_text(&[0xff, 0xfe]), None);
    }

    #[test]
    fn targets_never_escape_the_project_or_follow_links() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(safe_target(root, "../x").is_none());
        assert!(safe_target(root, "/etc/passwd").is_none());
        assert!(safe_target(root, ".git/config").is_none());
        assert!(safe_target(root, "project.json").is_none());
        assert_eq!(safe_target(root, "a/b.tex"), Some(root.join("a/b.tex")));
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.join("link")).unwrap();
            assert!(safe_target(root, "link/x.tex").is_none());
        }
    }

    #[test]
    fn writes_skip_identical_content_and_moves_need_a_free_target() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(write_file(root, "a/main.tex", b"one").unwrap());
        assert!(!write_file(root, "a/main.tex", b"one").unwrap());
        move_path(root, "a/main.tex", "b/thesis.tex");
        assert_eq!(std::fs::read(root.join("b/thesis.tex")).unwrap(), b"one");
        remove_path(root, "b/thesis.tex");
        assert!(!root.join("b/thesis.tex").exists());
        remove_path(root, "b");
        assert!(!root.join("b").exists());
    }

    #[test]
    fn disk_state_round_trips_and_a_missing_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("disk.json");
        assert_eq!(DiskState::load(&path), DiskState::default());
        let mut state = DiskState::default();
        state.hashes.insert("main.tex".to_owned(), sha256_hex(b"x"));
        state.save(&path).unwrap();
        assert_eq!(DiskState::load(&path), state);
    }
}
