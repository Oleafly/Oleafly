//! Lists a project's files for a turn: every regular file with its size,
//! modification time and cloud-placeholder state, plus symbolic links and
//! folders or files that could not be read, and every folder visited.
//! Nothing here reads content.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::{Instant, UNIX_EPOCH};

const MAX_DEPTH: usize = oleafly_core::MAX_DISCOVERY_DEPTH;
const SKIPPED_DIRECTORIES: [&str; 5] = [".git", ".oleafly", "node_modules", ".venv", "__pycache__"];
const SKIPPED_DIRECTORY_PREFIXES: [&str; 2] = ["_minted", "pythontex-files-"];
const SKIPPED_FILES: [&str; 3] = [".DS_Store", "Thumbs.db", "desktop.ini"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FileStat {
    pub(super) size: u64,
    pub(super) mtime: Option<i64>,
    pub(super) placeholder: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Entry {
    File(FileStat),
    Symlink,
    Unreadable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum WalkStop {
    TooManyFiles,
    Timeout,
    /// The project folder itself could not be listed in full.
    RootUnreadable,
}

/// Project-relative, `/`-separated paths.
pub(super) type Tree = BTreeMap<String, Entry>;

pub(super) struct Walked {
    pub(super) tree: Tree,
    /// Every folder visited, readable or not.
    pub(super) folders: BTreeSet<String>,
}

/// Walks `root`. `managed_root_file` names root-level files Oleafly manages
/// itself (the library manifest), which are left out.
///
/// A folder whose listing fails, even part way, is recorded as unreadable so
/// nothing under it is taken as added or deleted; for the project folder
/// itself the walk stops.
pub(super) fn walk(
    root: &Path,
    managed_root_file: &dyn Fn(&str) -> bool,
    max_files: usize,
    deadline: Instant,
) -> Result<Walked, WalkStop> {
    let mut walker = Walker {
        tree: Tree::new(),
        folders: BTreeSet::new(),
        files: 0,
        max_files,
        deadline,
        managed_root_file,
    };
    walker.visit(root, "", 0)?;
    Ok(Walked {
        tree: walker.tree,
        folders: walker.folders,
    })
}

struct Walker<'a> {
    tree: Tree,
    folders: BTreeSet<String>,
    files: usize,
    max_files: usize,
    deadline: Instant,
    managed_root_file: &'a dyn Fn(&str) -> bool,
}

impl Walker<'_> {
    fn visit(&mut self, directory: &Path, prefix: &str, depth: usize) -> Result<(), WalkStop> {
        if Instant::now() >= self.deadline {
            return Err(WalkStop::Timeout);
        }
        if !prefix.is_empty() {
            self.folders.insert(prefix.to_owned());
        }
        let Ok(entries) = std::fs::read_dir(directory) else {
            return self.unreadable(prefix);
        };
        for entry in entries {
            let entry = entry.and_then(|entry| test_listing_error(prefix).map_or(Ok(entry), Err));
            let Ok(entry) = entry else {
                // Nothing after the error can be trusted to be listed, so
                // the whole folder counts as unreadable.
                return self.unreadable(prefix);
            };
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                // A name that is not valid Unicode cannot be addressed by a
                // relative path string, so it can never be undone.
                let lossy = file_name.to_string_lossy();
                self.tree.insert(join(prefix, &lossy), Entry::Unreadable);
                continue;
            };
            let relative = join(prefix, name);
            let Ok(file_type) = entry.file_type() else {
                self.tree.insert(relative, Entry::Unreadable);
                continue;
            };
            if file_type.is_symlink() {
                self.tree.insert(relative, Entry::Symlink);
            } else if file_type.is_dir() {
                if !skipped_directory(name) && depth < MAX_DEPTH {
                    self.visit(&entry.path(), &relative, depth + 1)?;
                }
            } else if file_type.is_file()
                && !skipped_file(name)
                && !(prefix.is_empty() && (self.managed_root_file)(name))
            {
                self.files += 1;
                if self.files > self.max_files {
                    return Err(WalkStop::TooManyFiles);
                }
                let entry = match entry.metadata() {
                    Ok(metadata) => Entry::File(FileStat {
                        size: metadata.len(),
                        mtime: mtime_ns(&metadata),
                        placeholder: is_placeholder(&metadata, name),
                    }),
                    Err(_) => Entry::Unreadable,
                };
                self.tree.insert(relative, entry);
            }
        }
        Ok(())
    }

    fn unreadable(&mut self, prefix: &str) -> Result<(), WalkStop> {
        if prefix.is_empty() {
            return Err(WalkStop::RootUnreadable);
        }
        self.tree.insert(prefix.to_owned(), Entry::Unreadable);
        Ok(())
    }
}

fn join(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_owned()
    } else {
        format!("{prefix}/{name}")
    }
}

fn starts_with_ignoring_case(name: &str, prefix: &str) -> bool {
    name.len() >= prefix.len()
        && name.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

fn skipped_directory(name: &str) -> bool {
    oleafly_core::is_generated_directory(std::ffi::OsStr::new(name))
        || SKIPPED_DIRECTORIES
            .iter()
            .any(|skipped| name.eq_ignore_ascii_case(skipped))
        || SKIPPED_DIRECTORY_PREFIXES
            .iter()
            .any(|prefix| starts_with_ignoring_case(name, prefix))
}

fn skipped_file(name: &str) -> bool {
    SKIPPED_FILES
        .iter()
        .any(|skipped| name.eq_ignore_ascii_case(skipped))
        || crate::checkpoint_capture::is_oleafly_owned(name)
}

pub(super) fn mtime_ns(metadata: &std::fs::Metadata) -> Option<i64> {
    let modified = metadata.modified().ok()?;
    Some(match modified.duration_since(UNIX_EPOCH) {
        Ok(elapsed) => i64::try_from(elapsed.as_nanos()).unwrap_or(i64::MAX),
        Err(before) => -i64::try_from(before.duration().as_nanos()).unwrap_or(i64::MAX),
    })
}

fn is_placeholder(metadata: &std::fs::Metadata, name: &str) -> bool {
    oleafly_core::is_cloud_placeholder(metadata) || test_placeholder(name)
}

#[cfg(test)]
static TEST_PLACEHOLDERS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Tests cannot make real cloud placeholders; they name files to treat as one.
#[cfg(test)]
pub(super) fn set_test_placeholders(names: &[&str]) {
    *TEST_PLACEHOLDERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) =
        names.iter().map(|name| (*name).to_owned()).collect();
}

#[cfg(test)]
fn test_placeholder(name: &str) -> bool {
    TEST_PLACEHOLDERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .any(|placeholder| placeholder == name)
}

#[cfg(not(test))]
fn test_placeholder(_name: &str) -> bool {
    false
}

#[cfg(test)]
static TEST_LISTING_ERRORS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Tests cannot make a folder listing fail part way; they name folders (`""`
/// is the project folder) whose listing fails at its first entry.
#[cfg(test)]
pub(super) fn set_test_listing_errors(folders: &[&str]) {
    *TEST_LISTING_ERRORS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) =
        folders.iter().map(|folder| (*folder).to_owned()).collect();
}

#[cfg(test)]
fn test_listing_error(prefix: &str) -> Option<std::io::Error> {
    TEST_LISTING_ERRORS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .any(|folder| folder == prefix)
        .then(|| std::io::Error::other("test listing error"))
}

#[cfg(not(test))]
fn test_listing_error(_prefix: &str) -> Option<std::io::Error> {
    None
}
