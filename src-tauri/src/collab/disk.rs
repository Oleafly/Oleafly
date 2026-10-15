use std::borrow::Cow;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use oleafly_collab::doc::{FileNode, NodeKind, NodeParent};
use oleafly_collab::materialize::Layout;
use oleafly_collab::{write_atomic, CollabError};
use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};

pub const MAX_SCAN_DEPTH: usize = 32;
pub const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;
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
    if bytes.len() > MAX_TEXT_BYTES || bytes.contains(&0) {
        return None;
    }
    std::str::from_utf8(bytes)
        .ok()
        .map(|text| lf_text(text).into_owned())
}

// The shared document and the editor hold LF only; the disk keeps each file's style.
pub fn lf_text(text: &str) -> Cow<'_, str> {
    if text.contains('\r') {
        Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(text)
    }
}

pub fn crlf_only(bytes: &[u8]) -> Option<bool> {
    let mut lines = 0usize;
    let mut crlf = 0usize;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            lines += 1;
            if index > 0 && bytes[index - 1] == b'\r' {
                crlf += 1;
            }
        }
    }
    (lines > 0).then_some(crlf == lines)
}

pub fn written_as(text: &str, known: &str) -> bool {
    sha256_hex(text.as_bytes()) == known || sha256_hex(&with_line_endings(text, true)) == known
}

pub fn with_line_endings(text: &str, crlf: bool) -> Vec<u8> {
    if crlf {
        text.replace("\r\n", "\n")
            .replace('\n', "\r\n")
            .into_bytes()
    } else {
        text.as_bytes().to_vec()
    }
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

pub fn scratch_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".swp", ".swo", ".swx"]
        .iter()
        .any(|swap| lower.ends_with(swap))
        || name.ends_with('~')
        || (name.len() > 1 && name.starts_with('#') && name.ends_with('#'))
        || name.starts_with(".#")
        || (name.starts_with(".~lock.") && name.ends_with('#'))
        || name.starts_with("~$")
        || name == "4913"
        || crate::checkpoint_capture::is_oleafly_owned(name)
}

#[derive(Clone, Debug, Default)]
pub struct ShareRules(Vec<IgnoreRule>);

impl ShareRules {
    pub fn load(root: &Path) -> ShareRules {
        ShareRules(
            std::fs::read_to_string(root.join(".gitignore"))
                .map(|text| parse_gitignore(&text))
                .unwrap_or_default(),
        )
    }

    fn skips(&self, name: &str, relative: &str, is_dir: bool) -> bool {
        scratch_name(name) || ignored(&self.0, relative, is_dir)
    }

    pub fn leaves_out(&self, relative: &str, is_dir: bool) -> bool {
        let segments: Vec<&str> = relative.split('/').collect();
        let name = segments.last().copied().unwrap_or(relative);
        self.skips(name, relative, is_dir)
            || (1..segments.len())
                .any(|end| self.skips(segments[end - 1], &segments[..end].join("/"), true))
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

fn app_folder(segment: &str) -> bool {
    let lowered = segment.to_lowercase();
    if ALWAYS_EXCLUDED
        .iter()
        .any(|name| name.to_lowercase() == lowered)
    {
        return true;
    }
    let upper = segment.to_uppercase();
    (upper.starts_with("GIT~") || upper.starts_with("OLEAFL~"))
        && oleafly_collab::materialize::short_alias(segment)
}

pub fn excluded_name(relative: &str) -> bool {
    if !relative.contains('/')
        && ROOT_EXCLUDED
            .iter()
            .any(|name| name.eq_ignore_ascii_case(relative))
    {
        return true;
    }
    relative.split('/').any(app_folder)
}

pub fn scan_folder(root: &Path) -> Result<Scan, String> {
    scan_folder_within(root, "")
}

pub fn scan_folder_within(root: &Path, folder: &str) -> Result<Scan, String> {
    let rules = ShareRules::load(root);
    let mut scan = Scan::default();
    let depth = folder.split('/').filter(|part| !part.is_empty()).count();
    walk(root, folder, &rules, &mut scan, depth)?;
    scan.files.sort();
    scan.dirs.sort();
    scan.excluded.sort();
    Ok(scan)
}

fn walk(
    root: &Path,
    relative: &str,
    rules: &ShareRules,
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
        if rules.skips(&name, &child, kind.is_dir()) {
            if crate::checkpoint_capture::is_oleafly_owned(&name) {
                continue;
            }
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
        if inside_app_folder(root, parent) {
            return Err(format!("refused to write {relative}"));
        }
    }
    crate::sandbox::atomic_write(&target, bytes)?;
    crate::folder_watch::note_own_write(&target);
    Ok(true)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stamp {
    length: u64,
    modified: Option<std::time::SystemTime>,
    identity: u64,
}

pub fn stamp_of(path: &Path) -> Option<Stamp> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        metadata.ino()
    };
    #[cfg(not(unix))]
    let identity = 0;
    Some(Stamp {
        length: metadata.len(),
        modified: metadata.modified().ok(),
        identity,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    Same,
    Written,
    ChangedOutside,
}

pub fn write_file_over(
    root: &Path,
    relative: &str,
    bytes: &[u8],
    checked: Option<&Stamp>,
) -> Result<WriteOutcome, String> {
    use std::io::Write;
    let target =
        safe_target(root, relative).ok_or_else(|| format!("refused to write {relative}"))?;
    if std::fs::read(&target).is_ok_and(|current| current == bytes) {
        return Ok(WriteOutcome::Same);
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        if inside_app_folder(root, parent) {
            return Err(format!("refused to write {relative}"));
        }
    }
    let mut staged = crate::sandbox::AtomicFile::new(&target)?;
    let file = staged.staging_file_mut();
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| error.to_string())?;
    if stamp_of(&target).as_ref() != checked {
        return Ok(WriteOutcome::ChangedOutside);
    }
    staged.commit()?;
    crate::folder_watch::note_own_write(&target);
    Ok(WriteOutcome::Written)
}

// The path a node's own names spell out, which is where a file found on
// disk sat when it was added. The layout may place the node elsewhere: a
// Windows device name like aux.tex or a character Windows refuses gets a
// safe name, and a second spelling of a taken name gets a suffix.
pub(crate) fn found_path(nodes: &[FileNode], id: &str) -> Option<String> {
    let by_id: BTreeMap<&str, &FileNode> =
        nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let mut current = *by_id.get(id)?;
    let mut names = vec![current.name.as_str()];
    for _ in 0..by_id.len() {
        match &current.parent {
            NodeParent::Root => {
                names.reverse();
                return Some(names.join("/"));
            }
            NodeParent::Node(parent) => {
                current = by_id
                    .get(parent.as_str())
                    .filter(|holder| holder.kind == NodeKind::Dir)?;
                names.push(current.name.as_str());
            }
            NodeParent::Trash => return None,
        }
    }
    None
}

// Moves each file or folder found at the first path of a pair to the
// second, the path the layout gives its node, parents first, so the next
// scan finds it under its node instead of importing it again. A target
// that is taken stays as it is. Returns the moves made.
pub(crate) fn follow_layout(
    root: &Path,
    mut wanted: Vec<(String, String)>,
) -> Vec<(String, String)> {
    wanted.retain(|(found, laid)| found != laid);
    wanted.sort_by_key(|(found, _)| found.matches('/').count());
    let mut moved: Vec<(String, String)> = Vec::new();
    for (found, laid) in wanted {
        let mut current = found;
        for (from, to) in &moved {
            if let Some(rest) = current.strip_prefix(from.as_str()) {
                if rest.starts_with('/') {
                    current = format!("{to}{rest}");
                }
            }
        }
        if current != laid && move_path(root, &current, &laid) {
            moved.push((current, laid));
        }
    }
    moved
}

// Moves every key at or under `from` to the same place under `to` and
// returns the old and new keys.
pub(crate) fn rekey_moved(
    hashes: &mut BTreeMap<String, String>,
    from: &str,
    to: &str,
) -> Vec<(String, String)> {
    let inside: Vec<String> = hashes
        .keys()
        .filter(|path| moved_key(path, from, to).is_some())
        .cloned()
        .collect();
    let mut moved = Vec::new();
    for path in inside {
        let (Some(hash), Some(key)) = (hashes.remove(&path), moved_key(&path, from, to)) else {
            continue;
        };
        hashes.insert(key.clone(), hash);
        moved.push((path, key));
    }
    moved
}

fn moved_key(path: &str, from: &str, to: &str) -> Option<String> {
    if path == from {
        return Some(to.to_owned());
    }
    path.strip_prefix(from)
        .filter(|rest| rest.starts_with('/'))
        .map(|rest| format!("{to}{rest}"))
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

fn inside_app_folder(root: &Path, folder: &Path) -> bool {
    let Ok(folder) = folder.canonicalize() else {
        return true;
    };
    [".git", ".oleafly"].iter().any(|name| {
        root.join(name)
            .canonicalize()
            .is_ok_and(|protected| folder.starts_with(protected))
    })
}

// APFS and HFS+ treat names that differ only in Unicode normalization as one
// name; NTFS and the Linux file systems do not.
fn spelled_alike(on_disk: &str, wanted: &str) -> bool {
    on_disk == wanted
        || (cfg!(target_os = "macos")
            && unicode_normalization::UnicodeNormalization::nfc(on_disk)
                .eq(unicode_normalization::UnicodeNormalization::nfc(wanted)))
}

fn same_name_here(first: &str, second: &str) -> bool {
    if cfg!(target_os = "macos") {
        oleafly_history::portable_fold(first) == oleafly_history::portable_fold(second)
    } else {
        first.to_lowercase() == second.to_lowercase()
    }
}

pub fn exists_exact(root: &Path, relative: &str) -> bool {
    let mut folder = root.to_path_buf();
    for part in relative.split('/') {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            return false;
        };
        let found = entries.filter_map(Result::ok).find_map(|entry| {
            entry
                .file_name()
                .to_str()
                .filter(|name| spelled_alike(name, part))
                .map(str::to_owned)
        });
        let Some(name) = found else {
            return false;
        };
        folder.push(name);
    }
    true
}

fn same_entry(first: &Path, second: &Path) -> bool {
    match (
        std::fs::symlink_metadata(first),
        std::fs::symlink_metadata(second),
    ) {
        (Ok(a), Ok(b)) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                a.dev() == b.dev() && a.ino() == b.ino()
            }
            #[cfg(not(unix))]
            {
                a.len() == b.len() && a.modified().ok() == b.modified().ok()
            }
        }
        _ => false,
    }
}

pub fn same_file(root: &Path, first: &str, second: &str) -> bool {
    if first == second || !same_name_here(first, second) {
        return false;
    }
    match (safe_target(root, first), safe_target(root, second)) {
        (Some(a), Some(b)) => exists_exact(root, first) && same_entry(&a, &b),
        _ => false,
    }
}

pub fn move_path(root: &Path, from: &str, to: &str) -> bool {
    let (Some(source), Some(target)) = (safe_target(root, from), safe_target(root, to)) else {
        return false;
    };
    if !exists_exact(root, from) {
        return false;
    }
    let case_only = same_name_here(from, to) && same_entry(&source, &target);
    if target.exists() && !case_only {
        return false;
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
        if inside_app_folder(root, parent) {
            return false;
        }
    }
    let moved = if case_only {
        let parking =
            source.with_file_name(format!(".oleafly-rename-{}", sha256_hex(to.as_bytes())));
        std::fs::rename(&source, &parking).is_ok() && std::fs::rename(&parking, &target).is_ok()
    } else {
        std::fs::rename(&source, &target).is_ok()
    };
    if moved {
        crate::folder_watch::note_own_removal(&source);
        crate::folder_watch::note_own_write(&target);
    }
    moved
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
    fn a_file_replaced_after_the_check_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "main.tex", "ours before");
        let checked = stamp_of(&root.join("main.tex"));
        let replacement = root.join(".main.tex.agent");
        std::fs::write(&replacement, "written by an agent").unwrap();
        std::fs::rename(&replacement, root.join("main.tex")).unwrap();
        assert_eq!(
            write_file_over(root, "main.tex", b"ours after", checked.as_ref()).unwrap(),
            WriteOutcome::ChangedOutside
        );
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            "written by an agent"
        );
        let fresh = stamp_of(&root.join("main.tex"));
        assert_eq!(
            write_file_over(root, "main.tex", b"ours after", fresh.as_ref()).unwrap(),
            WriteOutcome::Written
        );
        assert_eq!(
            write_file_over(root, "new.tex", b"new", None).unwrap(),
            WriteOutcome::Written
        );
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
    fn editor_and_oleafly_scratch_files_are_never_shared() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "main.tex", "x");
        write(root, ".gitignore", "*.aux\nbuild/\n");
        for scratch in [
            ".main.tex.swp",
            "main.tex~",
            "#main.tex#",
            ".~lock.notes.odt#",
            "~$report.docx",
            "4913",
            ".main.tex.oleafly-1-2-3.tmp",
            ".oleafly-rename-abc",
        ] {
            write(root, scratch, "scratch");
        }
        let scan = scan_folder(root).unwrap();
        let files: Vec<&str> = scan.files.iter().map(|(path, _)| path.as_str()).collect();
        assert_eq!(files, vec![".gitignore", "main.tex"]);
        assert!(!scan.excluded.iter().any(|path| path.contains("oleafly")));
        let rules = ShareRules::load(root);
        assert!(rules.leaves_out("main.aux", false));
        assert!(rules.leaves_out("build/out/main.log", false));
        assert!(rules.leaves_out("chapters/.intro.tex.swp", false));
        assert!(rules.leaves_out("backup~/main.tex", false));
        assert!(!rules.leaves_out("chapters/intro.tex", false));
        assert!(!rules.leaves_out("builder/main.tex", false));
        write(root, "backup~/main.tex", "an editor's backup folder");
        let files: Vec<String> = scan_folder(root)
            .unwrap()
            .files
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        assert!(
            !files.iter().any(|path| path.starts_with("backup~")),
            "{files:?}"
        );
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
    fn a_lone_carriage_return_reads_as_a_line_end_like_the_editor() {
        assert_eq!(as_text(b"a\rb\r\nc\n").as_deref(), Some("a\nb\nc\n"));
        assert_eq!(as_text(b"\r\r\n").as_deref(), Some("\n\n"));
        assert_eq!(lf_text("one\r\ntwo\rthree"), "one\ntwo\nthree");
        assert!(matches!(lf_text("plain\n"), Cow::Borrowed("plain\n")));
    }

    #[test]
    fn a_file_counts_as_crlf_only_when_every_line_ends_that_way() {
        assert_eq!(crlf_only(b"a\r\nb\r\n"), Some(true));
        assert_eq!(crlf_only(b"a\r\nb"), Some(true));
        assert_eq!(crlf_only(b"a\r\nb\n"), Some(false));
        assert_eq!(crlf_only(b"a\nb\n"), Some(false));
        assert_eq!(crlf_only(b"no line end"), None);
        assert_eq!(crlf_only(b"\n"), Some(false));
        assert_eq!(with_line_endings("a\nb\n", true), b"a\r\nb\r\n");
        assert_eq!(with_line_endings("a\r\nb\n", true), b"a\r\nb\r\n");
        assert_eq!(with_line_endings("a\nb\n", false), b"a\nb\n");
        assert!(written_as("a\nb\n", &sha256_hex(b"a\r\nb\r\n")));
        assert!(written_as("a\nb\n", &sha256_hex(b"a\nb\n")));
        assert!(!written_as("a\nb\n", &sha256_hex(b"a\nc\n")));
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
    fn app_folders_are_refused_in_any_case_and_short_name_form() {
        for path in [
            "sub/.GIT/config",
            ".Oleafly/build/x",
            "GIT~1/config",
            "a/oleafl~2/x",
        ] {
            assert!(excluded_name(path), "{path}");
        }
        assert!(!excluded_name("chapters/intro.tex"));
    }

    #[test]
    fn a_rename_that_only_changes_case_moves_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "Main.tex", "x");
        assert!(move_path(root, "Main.tex", "main.tex"));
        let names: Vec<String> = std::fs::read_dir(root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["main.tex".to_owned()]);
        assert!(exists_exact(root, "main.tex"));
        assert!(!exists_exact(root, "Main.tex"));
        write(root, "other.tex", "y");
        assert!(!move_path(root, "main.tex", "other.tex"));
    }

    #[test]
    fn names_that_differ_only_in_unicode_normalization_follow_the_file_system() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let decomposed = "figures/Gro\u{0308}\u{00df}e.png";
        let composed = "figures/Gr\u{00f6}\u{00df}e.png";
        write(root, decomposed, "plot");
        assert!(exists_exact(root, decomposed));
        assert_eq!(exists_exact(root, composed), cfg!(target_os = "macos"));
        assert_eq!(
            same_file(root, decomposed, composed),
            cfg!(target_os = "macos")
        );
        assert!(!exists_exact(root, "figures/gro\u{0308}\u{00df}e.png"));
    }

    #[test]
    fn very_large_text_is_kept_as_a_file_not_text() {
        let big = vec![b'a'; MAX_TEXT_BYTES + 1];
        assert_eq!(as_text(&big), None);
        assert!(as_text(&big[..1024]).is_some());
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
