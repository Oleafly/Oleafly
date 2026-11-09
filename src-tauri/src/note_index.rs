use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use crate::project::{list_projects_blocking, ProjectInfo, NOTE_KIND};

pub(crate) const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NoteEntry {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) main_doc: String,
    pub(crate) related_project: Option<String>,
    pub(crate) updated_at: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileKey {
    modified: Option<SystemTime>,
    size: u64,
}

impl FileKey {
    pub(crate) fn modified(&self) -> Option<SystemTime> {
        self.modified
    }
}

pub(crate) struct Parsed<T> {
    key: FileKey,
    value: Arc<T>,
}

pub(crate) type ParsedCache<T> = LazyLock<Mutex<HashMap<PathBuf, Parsed<T>>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LockMode {
    Bounded,
    Try,
}

const LOCK_BUDGET: Duration = Duration::from_millis(250);

pub(crate) type RootMark = Option<(PathBuf, Option<SystemTime>)>;

struct Listing {
    revision: u64,
    root: RootMark,
    notes: Arc<Vec<NoteEntry>>,
}

static REVISION: AtomicU64 = AtomicU64::new(0);
static LISTING: LazyLock<Mutex<Option<Listing>>> = LazyLock::new(|| Mutex::new(None));
#[derive(Default)]
struct Resolutions {
    revision: u64,
    root: Option<PathBuf>,
    paths: HashMap<(String, String), PathBuf>,
}

static RESOLVED: LazyLock<Mutex<Resolutions>> =
    LazyLock::new(|| Mutex::new(Resolutions::default()));

pub(crate) fn invalidate() {
    REVISION.fetch_add(1, Ordering::SeqCst);
}

pub(crate) fn revision() -> u64 {
    REVISION.load(Ordering::SeqCst)
}

fn root_mark() -> RootMark {
    let root = crate::paths::projects_root().ok()?;
    let modified = std::fs::metadata(&root)
        .ok()
        .and_then(|metadata| metadata.modified().ok());
    Some((root, modified))
}

fn entries(projects: &[ProjectInfo]) -> Vec<NoteEntry> {
    projects
        .iter()
        .filter(|project| project.kind == NOTE_KIND && !project.recovery_pending)
        .map(|project| NoteEntry {
            id: project.id.clone(),
            title: project.name.clone(),
            main_doc: project.main_doc.clone(),
            related_project: project.related_project.clone(),
            updated_at: project.updated_at,
        })
        .collect()
}

pub(crate) fn remember(projects: &[ProjectInfo], revision: u64, root: RootMark) {
    let notes = Arc::new(entries(projects));
    *LISTING.lock().unwrap_or_else(PoisonError::into_inner) = Some(Listing {
        revision,
        root,
        notes,
    });
}

pub(crate) fn listing_marks() -> (u64, RootMark) {
    (revision(), root_mark())
}

fn fresh_listing(revision: u64, root: RootMark) -> Option<Arc<Vec<NoteEntry>>> {
    LISTING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .filter(|listing| root.is_some() && listing.revision == revision && listing.root == root)
        .map(|listing| Arc::clone(&listing.notes))
}

pub(crate) fn notes() -> Result<Arc<Vec<NoteEntry>>, String> {
    let (revision, root) = listing_marks();
    if let Some(notes) = fresh_listing(revision, root.clone()) {
        return Ok(notes);
    }
    let projects = list_projects_blocking()?;
    Ok(Arc::new(entries(&projects)))
}

fn key_of(metadata: &std::fs::Metadata) -> FileKey {
    FileKey {
        modified: metadata.modified().ok(),
        size: metadata.len(),
    }
}

pub(crate) fn utf8_prefix(bytes: &[u8]) -> String {
    let end = match std::str::from_utf8(bytes) {
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        _ => bytes.len(),
    };
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

impl Resolutions {
    fn scoped(
        &mut self,
        revision: u64,
        root: Option<PathBuf>,
    ) -> &mut HashMap<(String, String), PathBuf> {
        if self.revision != revision || self.root != root {
            *self = Resolutions {
                revision,
                root,
                paths: HashMap::new(),
            };
        }
        &mut self.paths
    }
}

fn with_resolutions<T>(apply: impl FnOnce(&mut HashMap<(String, String), PathBuf>) -> T) -> T {
    let revision = revision();
    let root = crate::paths::projects_root().ok();
    let mut resolved = RESOLVED.lock().unwrap_or_else(PoisonError::into_inner);
    apply(resolved.scoped(revision, root))
}

fn resolved(entry: &NoteEntry) -> Option<PathBuf> {
    with_resolutions(|paths| {
        paths
            .get(&(entry.id.clone(), entry.main_doc.clone()))
            .cloned()
    })
}

fn resolve(entry: &NoteEntry) -> Result<PathBuf, String> {
    let path = crate::sandbox::resolve_readable(&entry.id, &entry.main_doc)?;
    with_resolutions(|paths| {
        paths.insert((entry.id.clone(), entry.main_doc.clone()), path.clone())
    });
    Ok(path)
}

fn cached_value<T>(
    cache: &ParsedCache<T>,
    path: &Path,
    key: Option<FileKey>,
) -> Option<(Arc<T>, FileKey)> {
    let cache = cache.lock().unwrap_or_else(PoisonError::into_inner);
    let parsed = cache.get(path)?;
    if key.is_some_and(|key| key != parsed.key) {
        return None;
    }
    Some((Arc::clone(&parsed.value), parsed.key))
}

fn unchanged<T>(cache: &ParsedCache<T>, entry: &NoteEntry) -> Option<(PathBuf, Arc<T>, FileKey)> {
    unchanged_at(cache, resolved(entry)?)
}

fn unchanged_at<T>(cache: &ParsedCache<T>, path: PathBuf) -> Option<(PathBuf, Arc<T>, FileKey)> {
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let (value, key) = cached_value(cache, &path, Some(key_of(&metadata)))?;
    Some((path, value, key))
}

pub(crate) fn read_parsed<T>(
    cache: &ParsedCache<T>,
    entry: &NoteEntry,
    mode: LockMode,
    parse: impl FnOnce(&str) -> T,
) -> Result<Option<(PathBuf, Arc<T>, FileKey)>, String> {
    if let Some(found) = unchanged(cache, entry) {
        return Ok(Some(found));
    }
    let path = resolve(entry)?;
    let lock = match mode {
        LockMode::Bounded => {
            crate::worktree_lock::ProjectWorktreeLock::shared_bounded(&entry.id, LOCK_BUDGET).ok()
        }
        LockMode::Try => crate::worktree_lock::ProjectWorktreeLock::try_shared(&entry.id)?,
    };
    let Some(_lock) = lock else {
        return Ok(cached_value(cache, &path, None).map(|(value, key)| (path, value, key)));
    };
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let key = key_of(&metadata);
    if let Some((value, key)) = cached_value(cache, &path, Some(key)) {
        return Ok(Some((path, value, key)));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .and_then(|file| file.take(MAX_NOTE_BYTES).read_to_end(&mut bytes))
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let value = Arc::new(parse(&utf8_prefix(&bytes)));
    cache.lock().unwrap_or_else(PoisonError::into_inner).insert(
        path.clone(),
        Parsed {
            key,
            value: Arc::clone(&value),
        },
    );
    Ok(Some((path, value, key)))
}

pub(crate) fn keep_only<T>(cache: &ParsedCache<T>, seen: &HashSet<PathBuf>) {
    cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|path, _| seen.contains(path));
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_CACHE: ParsedCache<String> = LazyLock::new(|| Mutex::new(HashMap::new()));

    fn info(id: &str, kind: &str, recovery_pending: bool) -> ProjectInfo {
        ProjectInfo {
            id: id.into(),
            name: format!("Name {id}"),
            main_doc: "note.md".into(),
            engine: "markdown".into(),
            kind: kind.into(),
            created_at: 1.0,
            updated_at: 2.0,
            color: String::new(),
            has_preview: false,
            exports: Vec::new(),
            forked_from: None,
            recovery_pending,
            location: crate::project_availability::ProjectLocationInfo::Library,
            last_opened_at: 0.0,
            shared: None,
            imported_from: None,
            related_project: Some("paper".into()),
        }
    }

    #[test]
    fn keeps_only_readable_notes_in_the_listing() {
        let listed = entries(&[
            info("a", NOTE_KIND, false),
            info("b", "document", false),
            info("c", NOTE_KIND, true),
        ]);
        assert_eq!(
            listed,
            vec![NoteEntry {
                id: "a".into(),
                title: "Name a".into(),
                main_doc: "note.md".into(),
                related_project: Some("paper".into()),
                updated_at: 2.0,
            }]
        );
    }

    #[test]
    fn a_listing_is_fresh_until_the_revision_or_the_root_moves() {
        let root: RootMark = Some((PathBuf::from("/library"), Some(SystemTime::UNIX_EPOCH)));
        let base = revision();
        remember(&[info("a", NOTE_KIND, false)], base, root.clone());
        assert_eq!(
            fresh_listing(base, root.clone()).map(|notes| notes.len()),
            Some(1)
        );
        assert!(fresh_listing(base, None).is_none());
        assert!(fresh_listing(
            base,
            Some((PathBuf::from("/other"), Some(SystemTime::UNIX_EPOCH)))
        )
        .is_none());
        invalidate();
        assert!(revision() > base);
        assert!(fresh_listing(revision(), root).is_none());
    }

    #[test]
    fn reads_a_file_once_and_again_only_after_it_changes() {
        let dir = std::env::temp_dir().join(format!("oleafly-note-index-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        std::fs::write(&path, "first").unwrap();
        let metadata = std::fs::metadata(&path).unwrap();
        TEST_CACHE.lock().unwrap().insert(
            path.clone(),
            Parsed {
                key: key_of(&metadata),
                value: Arc::new("first".to_string()),
            },
        );
        let (found, value, key) = unchanged_at(&TEST_CACHE, path.clone()).unwrap();
        assert_eq!(found, path);
        assert_eq!(value.as_str(), "first");
        assert_eq!(key.modified(), metadata.modified().ok());
        std::fs::write(&path, "second, longer").unwrap();
        assert!(unchanged_at(&TEST_CACHE, path.clone()).is_none());
        assert!(cached_value(&TEST_CACHE, &path, None).is_some());
        let mut seen = HashSet::new();
        keep_only(&TEST_CACHE, &seen);
        assert!(cached_value(&TEST_CACHE, &path, None).is_none());
        seen.insert(path.clone());
        keep_only(&TEST_CACHE, &seen);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resolved_paths_belong_to_one_library_and_one_revision() {
        let mut resolved = Resolutions::default();
        let key = ("n".to_string(), "note.md".to_string());
        let library = Some(PathBuf::from("/library/projects"));
        resolved
            .scoped(3, library.clone())
            .insert(key.clone(), PathBuf::from("/library/projects/n/note.md"));
        assert!(resolved.scoped(3, library.clone()).contains_key(&key));
        assert!(resolved
            .scoped(3, Some(PathBuf::from("/other/projects")))
            .is_empty());
        resolved
            .scoped(3, library.clone())
            .insert(key.clone(), PathBuf::from("/library/projects/n/note.md"));
        assert!(resolved.scoped(4, library).is_empty());
        assert!(resolved.scoped(4, None).is_empty());
    }

    #[test]
    fn keeps_a_whole_prefix_of_utf8() {
        assert_eq!(utf8_prefix("aé".as_bytes()), "aé");
        assert_eq!(utf8_prefix(&"aé".as_bytes()[..2]), "a");
        assert_eq!(utf8_prefix(&[b'a', 0xff, b'b']), "a\u{fffd}b");
    }
}
