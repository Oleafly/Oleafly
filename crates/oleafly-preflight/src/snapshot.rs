use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::SystemTime;

use crate::bib::{
    accepts_bibliography_yaml, bibliography_candidate_paths, is_bibliography_yaml_candidate,
    is_hayagriva_path, BibliographyEngine,
};
use crate::jsre::JsRegex;
use crate::text::normalize_line_endings;
use crate::typst::references::{typst_path_references, TypstPathKind};
use crate::typst::scan::scan_typst;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapshotLimits {
    pub max_text_bytes: usize,
    pub max_depth: usize,
    pub max_total_bytes: usize,
}

impl Default for SnapshotLimits {
    fn default() -> Self {
        Self {
            max_text_bytes: 2_000_000,
            max_depth: 64,
            max_total_bytes: 256 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotIssue {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Default)]
pub struct ProjectSnapshot {
    pub root: PathBuf,
    pub main_document: String,
    pub tree_paths: Vec<String>,
    pub texts: BTreeMap<String, String>,
    pub oversized: Vec<String>,
    pub unreadable: Vec<SnapshotIssue>,
}

static INDEXABLE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)\.(?:tex|ltx|latex|sty|cls|typ|md|markdown|bib)$"));

fn is_vendored_typst_package(path: &str) -> bool {
    let replaced = path.replace('\\', "/");
    let trimmed = replaced.trim_start_matches('/');
    trimmed.split('/').next() == Some("typst-packages")
}

pub fn is_indexable_path(path: &str) -> bool {
    !is_vendored_typst_package(path) && INDEXABLE.is_match(path)
}

fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    limits: SnapshotLimits,
    out: &mut Vec<String>,
    unreadable: &mut Vec<SnapshotIssue>,
) -> io::Result<()> {
    if depth >= limits.max_depth {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if depth > 0 => {
            unreadable.push(SnapshotIssue {
                path: relative_slash(root, dir),
                message: error.to_string(),
            });
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    let mut items: Vec<fs::DirEntry> = entries.filter_map(Result::ok).collect();
    items.sort_by_key(fs::DirEntry::file_name);
    for entry in items {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".oleafly" || name == ".git" {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            walk(root, &path, depth + 1, limits, out, unreadable)?;
        } else {
            out.push(relative_slash(root, &path));
        }
    }
    Ok(())
}

fn relative_slash(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

enum TextRead {
    Text(String),
    TooLarge,
}

fn read_text(path: &Path, max_bytes: usize) -> io::Result<TextRead> {
    let file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(max_bytes as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        return Ok(TextRead::TooLarge);
    }
    let text = String::from_utf8_lossy(&bytes);
    Ok(TextRead::Text(normalize_line_endings(&text).into_owned()))
}

fn referenced_bibliography_yaml(texts: &BTreeMap<String, String>) -> Vec<String> {
    let mut referenced = Vec::new();
    for (file, text) in texts {
        if !file.to_lowercase().ends_with(".typ") {
            continue;
        }
        for reference in typst_path_references(&scan_typst(text)) {
            if reference.kind != TypstPathKind::Bibliography || !is_hayagriva_path(&reference.raw) {
                continue;
            }
            referenced.extend(bibliography_candidate_paths(
                &reference.raw,
                file,
                BibliographyEngine::Typst,
            ));
        }
    }
    referenced
}

impl ProjectSnapshot {
    pub fn load(root: &Path, main_document: &str, limits: SnapshotLimits) -> io::Result<Self> {
        Self::load_with(root, main_document, limits, &|_| false)
    }

    pub fn load_with(
        root: &Path,
        main_document: &str,
        limits: SnapshotLimits,
        unread: &dyn Fn(&str) -> bool,
    ) -> io::Result<Self> {
        let mut tree_paths = Vec::new();
        let mut unreadable = Vec::new();
        walk(root, root, 0, limits, &mut tree_paths, &mut unreadable)?;
        let mut texts = BTreeMap::new();
        let mut oversized = Vec::new();
        let mut yaml_candidates = Vec::new();
        let mut read_bytes = 0_usize;
        let mut over_total = false;
        for path in &tree_paths {
            let yaml = is_bibliography_yaml_candidate(path) && !is_vendored_typst_package(path);
            if !is_indexable_path(path) && !yaml {
                continue;
            }
            let mut parts: Vec<&str> = path.split('/').collect();
            parts.pop();
            if parts.into_iter().any(unread) {
                continue;
            }
            if read_bytes >= limits.max_total_bytes {
                if !over_total {
                    over_total = true;
                    unreadable.push(SnapshotIssue {
                        path: path.clone(),
                        message: "this and the sources after it were left unread because the project's sources are too large together".to_string(),
                    });
                }
                continue;
            }
            match read_text(&root.join(path), limits.max_text_bytes) {
                Ok(TextRead::Text(text)) if yaml => {
                    read_bytes += text.len();
                    yaml_candidates.push((path.clone(), text));
                }
                Ok(TextRead::Text(text)) => {
                    read_bytes += text.len();
                    texts.insert(path.clone(), text);
                }
                Ok(TextRead::TooLarge) => oversized.push(path.clone()),
                Err(error) => unreadable.push(SnapshotIssue {
                    path: path.clone(),
                    message: error.to_string(),
                }),
            }
        }
        let referenced = referenced_bibliography_yaml(&texts);
        for (path, text) in yaml_candidates {
            if accepts_bibliography_yaml(&text, || referenced.contains(&path)) {
                texts.insert(path, text);
            }
        }
        Ok(Self {
            root: root.to_path_buf(),
            main_document: main_document.to_string(),
            tree_paths,
            texts,
            oversized,
            unreadable,
        })
    }

    pub fn from_parts(
        main_document: &str,
        tree_paths: Vec<String>,
        texts: BTreeMap<String, String>,
    ) -> Self {
        Self {
            root: PathBuf::new(),
            main_document: main_document.to_string(),
            tree_paths,
            texts,
            oversized: Vec::new(),
            unreadable: Vec::new(),
        }
    }

    pub fn file_size(&self, path: &str) -> Option<u64> {
        if self.root.as_os_str().is_empty() {
            return None;
        }
        fs::metadata(self.root.join(path))
            .ok()
            .filter(fs::Metadata::is_file)
            .map(|metadata| metadata.len())
    }

    pub fn newest_text_modified(&self) -> Option<SystemTime> {
        if self.root.as_os_str().is_empty() {
            return None;
        }
        self.texts
            .keys()
            .chain(self.oversized.iter())
            .filter_map(|path| fs::metadata(self.root.join(path)).ok()?.modified().ok())
            .max()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, path: &str, bytes: &[u8]) {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, bytes).unwrap();
    }

    #[test]
    fn tree_order_matches_the_app_walk() {
        let dir = tempfile::tempdir().unwrap();
        for path in ["B.tex", "a.tex", "a/x.tex", "b/y.tex"] {
            write(dir.path(), path, b"x");
        }
        let snapshot =
            ProjectSnapshot::load(dir.path(), "a.tex", SnapshotLimits::default()).unwrap();
        assert_eq!(
            snapshot.tree_paths,
            vec!["B.tex", "a/x.tex", "a.tex", "b/y.tex"]
        );
    }

    #[test]
    fn git_and_oleafly_are_skipped_but_node_modules_is_listed() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".git/h.tex", b"x");
        write(dir.path(), ".oleafly/x.tex", b"x");
        write(dir.path(), "node_modules/n.md", b"# n");
        write(dir.path(), "main.tex", b"x");
        let snapshot =
            ProjectSnapshot::load(dir.path(), "main.tex", SnapshotLimits::default()).unwrap();
        assert_eq!(snapshot.tree_paths, vec!["main.tex", "node_modules/n.md"]);
        assert!(snapshot.texts.contains_key("node_modules/n.md"));
    }

    #[test]
    fn sources_in_named_folders_are_listed_but_not_read() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "main.tex", b"x");
        write(dir.path(), "node_modules/dep/README.md", b"# dep");
        write(dir.path(), "out/fig.pdf", b"%PDF");
        write(dir.path(), "out/flat.tex", b"flattened");
        write(dir.path(), "chapters/one.tex", b"one");
        let unread = |name: &str| matches!(name, "node_modules" | "out");
        let snapshot =
            ProjectSnapshot::load_with(dir.path(), "main.tex", SnapshotLimits::default(), &unread)
                .unwrap();
        assert!(snapshot.tree_paths.contains(&"out/fig.pdf".to_string()));
        assert!(snapshot
            .tree_paths
            .contains(&"node_modules/dep/README.md".to_string()));
        let read: Vec<_> = snapshot.texts.keys().map(String::as_str).collect();
        assert_eq!(read, vec!["chapters/one.tex", "main.tex"]);
        assert!(snapshot.unreadable.is_empty() && snapshot.oversized.is_empty());
    }

    #[test]
    fn reading_stops_at_the_total_and_says_so_once() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a.tex", "b.tex", "c.tex", "d.tex"] {
            write(dir.path(), name, &[b'x'; 100]);
        }
        let limits = SnapshotLimits {
            max_total_bytes: 150,
            ..SnapshotLimits::default()
        };
        let snapshot = ProjectSnapshot::load(dir.path(), "a.tex", limits).unwrap();
        let read: Vec<_> = snapshot.texts.keys().map(String::as_str).collect();
        assert_eq!(read, vec!["a.tex", "b.tex"]);
        assert_eq!(snapshot.tree_paths.len(), 4);
        assert_eq!(snapshot.unreadable.len(), 1);
        assert_eq!(snapshot.unreadable[0].path, "c.tex");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "main.tex", b"x");
        std::os::unix::fs::symlink(dir.path().join("main.tex"), dir.path().join("link.tex"))
            .unwrap();
        let snapshot =
            ProjectSnapshot::load(dir.path(), "main.tex", SnapshotLimits::default()).unwrap();
        assert_eq!(snapshot.tree_paths, vec!["main.tex"]);
    }

    #[test]
    fn oversized_text_is_listed_without_content() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "big.tex", &vec![b'a'; 2_000_001]);
        let snapshot =
            ProjectSnapshot::load(dir.path(), "big.tex", SnapshotLimits::default()).unwrap();
        assert_eq!(snapshot.tree_paths, vec!["big.tex"]);
        assert!(!snapshot.texts.contains_key("big.tex"));
        assert_eq!(snapshot.oversized, vec!["big.tex"]);
    }

    #[test]
    fn invalid_utf8_is_decoded_lossily_like_the_app() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "main.tex", &[b'a', 0xFF, b'b', b'\r', b'\n']);
        let snapshot =
            ProjectSnapshot::load(dir.path(), "main.tex", SnapshotLimits::default()).unwrap();
        assert_eq!(snapshot.texts["main.tex"], "a\u{FFFD}b\n");
    }

    #[test]
    fn ten_thousand_files_read_only_indexable_sources() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("img")).unwrap();
        for index in 0..10_000 {
            fs::write(dir.path().join(format!("img/i{index}.png")), b"").unwrap();
        }
        write(dir.path(), "main.tex", b"x");
        let snapshot =
            ProjectSnapshot::load(dir.path(), "main.tex", SnapshotLimits::default()).unwrap();
        assert_eq!(snapshot.texts.len(), 1);
        assert_eq!(snapshot.tree_paths.len(), 10_001);
    }

    #[test]
    fn yaml_joins_only_when_it_looks_like_a_bibliography() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "refs.yml",
            b"smith:\n  type: article\n  title: X\n",
        );
        write(dir.path(), "config.yml", b"name: app\n");
        write(dir.path(), "pnpm-lock.yaml", b"smith:\n  type: article\n");
        let snapshot =
            ProjectSnapshot::load(dir.path(), "main.typ", SnapshotLimits::default()).unwrap();
        let keys: Vec<_> = snapshot.texts.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["refs.yml"]);
    }

    #[test]
    fn vendored_typst_packages_are_not_indexed() {
        assert!(!is_indexable_path("typst-packages/preview/x/lib.typ"));
        assert!(is_indexable_path("chapters/intro.TYP"));
    }
}
