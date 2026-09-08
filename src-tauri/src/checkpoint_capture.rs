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
    pub fn capture_inputs(&self) -> Result<Vec<CaptureInput>, String> {
        self.captured
            .iter()
            .map(|file| {
                CaptureInput::explicit(file.relative_path.clone())
                    .map_err(|error| error.to_string())
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

pub fn walk_project(project_root: &Path) -> Result<ProjectWalk, String> {
    walk_project_with(project_root, |_| {}).map_err(|error| error.to_string())
}

fn walk_project_with(
    project_root: &Path,
    mut before_read: impl FnMut(&Path),
) -> std::io::Result<ProjectWalk> {
    match walk_project_once(project_root, &mut before_read) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            walk_project_once(project_root, &mut before_read)
        }
        result => result,
    }
}

fn walk_project_once(
    project_root: &Path,
    before_read: &mut impl FnMut(&Path),
) -> std::io::Result<ProjectWalk> {
    let mut walk = ProjectWalk::default();
    let mut pending = vec![project_root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        before_read(&directory);
        let entries = std::fs::read_dir(&directory).map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!("Could not read {}: {error}", directory.display()),
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                std::io::Error::new(
                    error.kind(),
                    format!("Could not read a directory entry: {error}"),
                )
            })?;
            let path = entry.path();
            let relative = path
                .strip_prefix(project_root)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
            let name = entry.file_name();
            if name.to_str().is_some_and(is_excluded_component) {
                continue;
            }
            let portable = portable_relative(relative).ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("Unsupported checkpoint path: {}", relative.display()),
                )
            })?;
            CaptureInput::explicit(portable.clone()).map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("The name {portable} cannot be stored in a checkpoint. Use a name that works on macOS, Windows and Linux.")))?;
            before_read(&path);
            let metadata = entry.metadata().map_err(|error| {
                std::io::Error::new(
                    error.kind(),
                    format!("Could not inspect {portable}: {error}"),
                )
            })?;
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                return Err(std::io::Error::new(std::io::ErrorKind::Unsupported, format!("{portable} is not a regular file. Checkpoints cannot capture symbolic links or special files.")));
            }
            let content_hash = capture_hash(&path, &portable)?;
            walk.captured.push(CapturedFile {
                relative_path: portable,
                content_hash,
            });
        }
    }
    walk.captured
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(walk)
}

fn capture_hash(path: &Path, relative: &str) -> std::io::Result<ContentHash> {
    ContentHash::digest_file(path).map_err(|error| {
        let kind = match &error {
            oleafly_history::HistoryError::Io(error) => error.kind(),
            _ => std::io::ErrorKind::Other,
        };
        std::io::Error::new(kind, format!("Could not read {relative}: {error}"))
    })
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
    fn retries_disappearing_entries_without_omitting_remaining_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"keep");
        write(root, "transient.tex", b"delete");
        let mut removed = false;
        let walk = walk_project_with(root, |path| {
            if path.ends_with("transient.tex") && !removed {
                std::fs::remove_file(path).unwrap();
                removed = true;
            }
        })
        .unwrap();
        assert!(removed);
        assert_eq!(captured_paths(&walk), vec!["main.tex"]);
    }

    #[test]
    fn retries_a_directory_removed_after_it_was_queued() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"keep");
        write(root, "transient/file.tex", b"delete");
        let mut visits = 0;
        let walk = walk_project_with(root, |path| {
            if path.ends_with("transient") {
                visits += 1;
                if visits == 2 {
                    std::fs::remove_dir_all(path).unwrap();
                }
            }
        })
        .unwrap();
        assert_eq!(visits, 2);
        assert_eq!(captured_paths(&walk), vec!["main.tex"]);
    }

    #[test]
    fn stops_after_one_rewalk_when_the_directory_remains_missing() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        let mut attempts = 0;
        let result = walk_project_with(&missing, |_| attempts += 1);
        assert_eq!(attempts, 2);
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn captures_every_source_file_including_ones_the_compiler_never_reads() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"\\documentclass{article}");
        write(root, "refs.bib", b"@book{a,title={A}}");
        write(root, "README.md", b"notes nobody compiles");
        write(root, "figures/plot.pdf", b"%PDF-1.4");

        let walk = walk_project(root).unwrap();

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

        let walk = walk_project(root).unwrap();

        assert_eq!(captured_paths(&walk), vec!["main.tex"]);
    }

    #[test]
    fn unchanged_tree_matches_the_recorded_checkpoint() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "notes.md", b"notes");
        let walk = walk_project(root).unwrap();
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
        let changed = walk_project(root).unwrap();
        assert!(!changed.matches_checkpoint(&files));
    }

    #[test]
    fn a_new_file_alone_counts_as_a_change() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        let before = walk_project(root).unwrap();
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
        let after = walk_project(root).unwrap();

        assert!(!after.matches_checkpoint(&files));
    }

    #[test]
    fn every_captured_file_becomes_a_storable_input() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "chapters/one.tex", b"chapter");

        let inputs = walk_project(root).unwrap().capture_inputs().unwrap();

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

        let walk = walk_project(root).unwrap();

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
    fn decomposed_unicode_paths_are_captured_without_renaming() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "cafe\u{301}.tex", b"a name that is not Unicode NFC");
        write(root, "chapters/one.tex", b"chapter");

        let walk = walk_project(root).unwrap();

        assert_eq!(
            captured_paths(&walk),
            vec!["cafe\u{301}.tex", "chapters/one.tex", "main.tex"]
        );
        assert_eq!(walk.capture_inputs().unwrap().len(), 3);
    }
    #[test]
    fn an_unreadable_root_cannot_look_like_an_empty_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        assert!(walk_project(&missing).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn unsupported_paths_and_symlinks_cannot_produce_partial_snapshots() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "CON.tex", b"cannot restore on Windows");
        assert!(walk_project(root).unwrap_err().contains("CON.tex"));
        std::fs::remove_file(root.join("CON.tex")).unwrap();
        std::os::unix::fs::symlink("main.tex", root.join("linked.tex")).unwrap();
        assert!(walk_project(root).unwrap_err().contains("linked.tex"));
    }
}
