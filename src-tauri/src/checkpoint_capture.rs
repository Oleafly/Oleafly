use oleafly_history::{CaptureInput, CheckpointFile, ContentHash};
use std::collections::BTreeMap;
use std::path::{Component, Path};

const EXCLUDED_EXACT: [&str; 3] = [".git", ".oleafly", "node_modules"];
const EXCLUDED_PREFIX: [&str; 2] = ["_minted-", "pythontex-files-"];

#[derive(Clone, Debug)]
pub struct CapturedFile {
    pub relative_path: String,
    pub content_hash: ContentHash,
}

#[derive(Clone, Debug, Default)]
pub struct ProjectWalk {
    pub captured: Vec<CapturedFile>,
}

impl ProjectWalk {
    pub fn capture_inputs(&self) -> Vec<CaptureInput> {
        self.captured
            .iter()
            .filter_map(|file| CaptureInput::explicit(file.relative_path.clone()).ok())
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
        let component = component.as_bytes();
        let prefix = prefix.as_bytes();
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
            let Some(name) = path.file_name().and_then(std::ffi::OsStr::to_str) else {
                continue;
            };
            if is_excluded_component(name) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            if CaptureInput::explicit(portable.clone()).is_err() {
                continue;
            }
            let Ok(content_hash) = ContentHash::digest_file(&path) else {
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

        let inputs = walk_project(root).capture_inputs();

        assert_eq!(
            inputs
                .iter()
                .map(CaptureInput::relative_path)
                .collect::<Vec<_>>(),
            vec!["chapters/one.tex", "main.tex"]
        );
    }

    #[test]
    fn a_helper_cache_prefix_is_matched_without_splitting_a_character() {
        assert!(is_excluded_component("_minted-main"));
        assert!(is_excluded_component("_MINTED-Main"));
        assert!(is_excluded_component("pythontex-files-main"));
        assert!(!is_excluded_component("_minted-"));
        assert!(!is_excluded_component("_minted"));
        assert!(!is_excluded_component("_minted\u{e9}"));
        assert!(!is_excluded_component("pythontex-files\u{e9}"));
        assert!(!is_excluded_component("_mint\u{e9}"));
        assert!(!is_excluded_component("_mint\u{e9}d-main"));
        assert!(!is_excluded_component("\u{e9}"));
        assert!(!is_excluded_component("figures"));
    }

    #[test]
    fn a_non_ascii_directory_name_is_walked_like_any_other() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "_minted\u{e9}/one.tex", b"not a helper cache");
        write(root, "pythontex-files\u{e9}/two.tex", b"nor is this one");
        write(root, "fig\u{fc}res/plot.pdf", b"%PDF-1.4");
        write(root, "_minted-main/abc.pygtex", b"highlight");

        let walk = walk_project(root);

        assert_eq!(
            captured_paths(&walk),
            vec![
                "_minted\u{e9}/one.tex",
                "fig\u{fc}res/plot.pdf",
                "main.tex",
                "pythontex-files\u{e9}/two.tex"
            ]
        );
    }

    #[test]
    fn a_path_the_store_cannot_represent_is_skipped_instead_of_ending_the_capture() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "cafe\u{301}.tex", b"a name that is not Unicode NFC");
        write(root, "chapters/one.tex", b"chapter");

        let walk = walk_project(root);

        assert_eq!(captured_paths(&walk), vec!["chapters/one.tex", "main.tex"]);
        assert_eq!(walk.capture_inputs().len(), 2);
    }
}
