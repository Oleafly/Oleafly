use oleafly_history::{CaptureInput, CheckpointFile, ContentHash};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Component, Path};

const EXCLUDED_EXACT: [&str; 3] = [".git", ".oleafly", "node_modules"];
const EXCLUDED_PREFIX: [&str; 2] = ["_minted-", "pythontex-files-"];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UncapturedReason {
    Unreadable,
    NotARegularFile,
    NonPortablePath,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct UncapturedFile {
    pub relative_path: String,
    pub reason: UncapturedReason,
}

#[derive(Clone, Debug)]
pub struct CapturedFile {
    pub relative_path: String,
    pub content_hash: ContentHash,
}

#[derive(Clone, Debug, Default)]
pub struct ProjectWalk {
    pub captured: Vec<CapturedFile>,
    pub uncaptured: Vec<UncapturedFile>,
}

impl ProjectWalk {
    pub fn capture_inputs(&self) -> Result<Vec<CaptureInput>, String> {
        self.captured
            .iter()
            .map(|file| {
                CaptureInput::explicit(file.relative_path.clone())
                    .map_err(|error| format!("{}: {error}", file.relative_path))
            })
            .collect()
    }

    pub fn matches_checkpoint(&self, files: &[CheckpointFile]) -> bool {
        let recorded = files
            .iter()
            .map(|file| (file.relative_path.as_str(), file.content_hash))
            .collect::<BTreeMap<_, _>>();
        if recorded.len() != self.captured.len() {
            return false;
        }
        self.captured
            .iter()
            .all(|file| recorded.get(file.relative_path.as_str()) == Some(&file.content_hash))
    }
}

pub fn is_excluded_component(component: &str) -> bool {
    if EXCLUDED_EXACT
        .iter()
        .any(|name| component.eq_ignore_ascii_case(name))
    {
        return true;
    }
    EXCLUDED_PREFIX.iter().any(|prefix| {
        component.len() > prefix.len() && component[..prefix.len()].eq_ignore_ascii_case(prefix)
    })
}

fn portable_relative(relative: &Path) -> Option<String> {
    let mut portable = String::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if !portable.is_empty() {
            portable.push('/');
        }
        portable.push_str(part);
    }
    (!portable.is_empty()).then_some(portable)
}

pub fn walk_project(project_root: &Path) -> ProjectWalk {
    let mut walk = ProjectWalk::default();
    let mut pending = vec![project_root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(relative) = path.strip_prefix(project_root) else {
                continue;
            };
            let Some(portable) = portable_relative(relative) else {
                continue;
            };
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                walk.uncaptured.push(UncapturedFile {
                    relative_path: portable,
                    reason: UncapturedReason::NonPortablePath,
                });
                continue;
            };
            if is_excluded_component(name) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                walk.uncaptured.push(UncapturedFile {
                    relative_path: portable,
                    reason: UncapturedReason::Unreadable,
                });
                continue;
            };
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                walk.uncaptured.push(UncapturedFile {
                    relative_path: portable,
                    reason: UncapturedReason::NotARegularFile,
                });
                continue;
            }
            let Ok(content_hash) = ContentHash::digest_file(&path) else {
                walk.uncaptured.push(UncapturedFile {
                    relative_path: portable,
                    reason: UncapturedReason::Unreadable,
                });
                continue;
            };
            walk.captured.push(CapturedFile {
                relative_path: portable,
                content_hash,
            });
        }
    }
    walk.captured
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    walk.uncaptured
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    walk
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, bytes).unwrap();
    }

    fn captured_paths(walk: &ProjectWalk) -> Vec<&str> {
        walk.captured
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect()
    }

    #[test]
    fn captures_every_source_file_including_ones_the_compiler_never_reads() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"\\documentclass{article}");
        write(root, "refs.bib", b"@book{a,title={A}}");
        write(root, "README.md", b"notes nobody compiles");
        write(root, "figures/plot.pdf", b"%PDF-1.4");

        let walk = walk_project(root);

        assert_eq!(
            captured_paths(&walk),
            vec!["README.md", "figures/plot.pdf", "main.tex", "refs.bib"]
        );
        assert!(walk.uncaptured.is_empty());
    }

    #[test]
    fn skips_build_output_git_and_helper_caches() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, ".oleafly/build/main.pdf", b"%PDF");
        write(root, ".oleafly/build/main.aux", b"aux");
        write(root, ".git/config", b"[core]");
        write(root, "node_modules/pkg/index.js", b"module");
        write(root, "_minted-main/abc.pygtex", b"highlight");
        write(root, "pythontex-files-main/py.out", b"generated");

        let walk = walk_project(root);

        assert_eq!(captured_paths(&walk), vec!["main.tex"]);
    }

    #[test]
    fn unchanged_tree_matches_the_recorded_checkpoint() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "notes.md", b"notes");
        let walk = walk_project(root);
        let files = walk
            .captured
            .iter()
            .map(|file| CheckpointFile {
                relative_path: file.relative_path.clone(),
                logical_bytes: 0,
                content_hash: file.content_hash,
                stored: true,
                chunk_count: 1,
            })
            .collect::<Vec<_>>();

        assert!(walk.matches_checkpoint(&files));

        write(root, "notes.md", b"notes, revised");
        let changed = walk_project(root);
        assert!(!changed.matches_checkpoint(&files));
    }

    #[test]
    fn a_new_file_alone_counts_as_a_change() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        let before = walk_project(root);
        let files = before
            .captured
            .iter()
            .map(|file| CheckpointFile {
                relative_path: file.relative_path.clone(),
                logical_bytes: 0,
                content_hash: file.content_hash,
                stored: true,
                chunk_count: 1,
            })
            .collect::<Vec<_>>();

        write(root, "README.md", b"added later");
        let after = walk_project(root);

        assert!(!after.matches_checkpoint(&files));
    }

    #[test]
    fn every_captured_file_becomes_a_storable_input() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "chapters/one.tex", b"chapter");

        let inputs = walk_project(root).capture_inputs().unwrap();

        assert_eq!(inputs.len(), 2);
        assert!(inputs.iter().all(CaptureInput::is_stored));
    }
}
