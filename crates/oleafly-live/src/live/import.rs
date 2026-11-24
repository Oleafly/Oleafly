use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;

use super::live_tree::TreeRead;
use super::session::io;
use crate::disk::{
    as_text, crlf_only, excluded_name, exists_exact, inside, safe_target, scan_folder,
    scan_folder_within, sha256_hex, DiskState, ShareRules,
};

pub fn parent_of(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _)| parent)
}

pub fn name_of(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

pub fn by_path(layout: &Layout) -> HashMap<String, (String, NodeKind, Option<String>)> {
    layout
        .iter()
        .map(|(id, placed)| {
            (
                placed.path.clone(),
                (id.clone(), placed.kind, placed.blob.clone()),
            )
        })
        .collect()
}

#[derive(Default)]
pub struct LocalImport {
    pub texts: Vec<(String, String, String)>,
    pub blobs: Vec<(String, String, u64)>,
    pub removed: Vec<String>,
    pub dirs: Vec<String>,
    pub restamped: Vec<(String, String)>,
    pub crlf: BTreeSet<String>,
    pub moved_dirs: Vec<(String, String)>,
}

impl LocalImport {
    pub fn is_empty(&self) -> bool {
        self.texts.is_empty()
            && self.blobs.is_empty()
            && self.removed.is_empty()
            && self.dirs.is_empty()
            && self.restamped.is_empty()
    }
}

pub type Placed = HashMap<String, (String, NodeKind, Option<String>)>;

pub struct Scanned {
    import: LocalImport,
    known_texts: Vec<(String, String, String, String)>,
}

impl Scanned {
    pub fn classify(self, read: &(impl TreeRead + ?Sized)) -> LocalImport {
        let mut import = self.import;
        for (path, id, text, hash) in self.known_texts {
            if read.text(&id).ok().flatten().as_deref() == Some(text.as_str()) {
                import.restamped.push((path, hash));
            } else {
                import.texts.push((path, text, hash));
            }
        }
        import
    }
}

pub fn placed_now(read: &(impl TreeRead + ?Sized)) -> Result<Placed, CollabError> {
    Ok(by_path(&materialize::layout(&read.nodes()?)))
}

pub fn read_local_changes(
    root: &Path,
    disk: &DiskState,
    live: &LiveProject,
    only: Option<&[String]>,
) -> Result<LocalImport, CollabError> {
    let placed = placed_now(live)?;
    Ok(scan_local(root, disk, &placed, only)?.classify(live))
}

pub fn scan_local(
    root: &Path,
    disk: &DiskState,
    placed: &Placed,
    only: Option<&[String]>,
) -> Result<Scanned, CollabError> {
    let candidates = match only {
        Some(paths) => named_candidates(root, placed, paths),
        None => every_candidate(root, placed)?,
    };
    let rules = ShareRules::load(root);
    let owed = disk.owed_paths();
    let mut scanned = Scanned {
        import: LocalImport::default(),
        known_texts: Vec::new(),
    };
    for path in candidates {
        if path.is_empty() || excluded_name(&path) || owed.iter().any(|held| inside(&path, held)) {
            continue;
        }
        let Some(target) = safe_target(root, &path) else {
            continue;
        };
        let known = placed.get(&path);
        if known.is_none() && rules.leaves_out(&path, target.is_dir()) {
            continue;
        }
        let present = if exists_exact(root, &path) {
            std::fs::symlink_metadata(&target)
        } else {
            Err(std::io::Error::from(std::io::ErrorKind::NotFound))
        };
        match present {
            Ok(metadata) if metadata.is_file() => {
                read_changed_file(&mut scanned, disk, &target, path, known)?;
            }
            Ok(metadata) if metadata.is_dir() => {
                if known.is_none() {
                    scanned.import.dirs.push(path);
                }
            }
            Ok(_) => {}
            Err(_) => note_missing(&mut scanned.import, disk, path, known),
        }
    }
    Ok(scanned)
}

fn named_candidates(
    root: &Path,
    placed: &HashMap<String, (String, NodeKind, Option<String>)>,
    paths: &[String],
) -> BTreeSet<String> {
    let mut candidates: BTreeSet<String> = BTreeSet::new();
    for path in paths {
        candidates.insert(path.trim_matches('/').to_owned());
        let prefix = format!("{}/", path.trim_matches('/'));
        candidates.extend(
            placed
                .keys()
                .filter(|known| known.starts_with(&prefix))
                .cloned(),
        );
        if let Some(target) = safe_target(root, path) {
            if target.is_dir() {
                if let Ok(scan) = scan_folder_within(root, path.trim_matches('/')) {
                    candidates.extend(scan.files.into_iter().map(|(file, _)| file));
                    candidates.extend(scan.dirs);
                }
            }
        }
    }
    candidates
}

fn every_candidate(
    root: &Path,
    placed: &HashMap<String, (String, NodeKind, Option<String>)>,
) -> Result<BTreeSet<String>, CollabError> {
    let mut candidates: BTreeSet<String> = BTreeSet::new();
    let scan = scan_folder(root).map_err(CollabError::Io)?;
    candidates.extend(scan.files.into_iter().map(|(path, _)| path));
    candidates.extend(scan.dirs);
    candidates.extend(placed.keys().cloned());
    Ok(candidates)
}

#[cfg(any(test, feature = "test-support"))]
pub type ReadHook = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

#[cfg(any(test, feature = "test-support"))]
pub static BEFORE_READ: std::sync::Mutex<Option<ReadHook>> = std::sync::Mutex::new(None);

fn read_changed_file(
    scanned: &mut Scanned,
    disk: &DiskState,
    target: &Path,
    path: String,
    known: Option<&(String, NodeKind, Option<String>)>,
) -> Result<(), CollabError> {
    #[cfg(any(test, feature = "test-support"))]
    {
        let hook = BEFORE_READ
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(hook) = hook {
            hook(&path);
        }
    }
    let bytes = std::fs::read(target).map_err(io)?;
    let hash = sha256_hex(&bytes);
    if disk.hashes.get(&path) == Some(&hash) && known.is_some() {
        return Ok(());
    }
    let import = &mut scanned.import;
    let text = as_text(&bytes);
    if text.is_some() && crlf_only(&bytes) == Some(true) {
        import.crlf.insert(path.clone());
    }
    match (text, known) {
        (Some(text), Some((id, NodeKind::Text, _))) => {
            scanned.known_texts.push((path, id.clone(), text, hash));
        }
        (Some(text), None) => import.texts.push((path, text, hash)),
        (_, Some((_, NodeKind::Blob, Some(blob)))) if *blob == hash => {}
        (None, _) | (Some(_), Some(_)) => {
            import.blobs.push((path, hash, bytes.len() as u64));
        }
    }
    Ok(())
}

fn note_missing(
    import: &mut LocalImport,
    disk: &DiskState,
    path: String,
    known: Option<&(String, NodeKind, Option<String>)>,
) {
    let written = disk.hashes.contains_key(&path);
    let known_dir = known.is_some_and(|(_, kind, _)| *kind == NodeKind::Dir)
        && disk.layout.values().any(|entry| entry.path == path);
    if known.is_some() && (written || known_dir) {
        import.removed.push(path);
    }
}

pub fn ensure_dir(
    live: &mut LiveProject,
    placed: &mut HashMap<String, (String, NodeKind, Option<String>)>,
    path: Option<&str>,
) -> Result<Option<String>, CollabError> {
    let Some(path) = path.filter(|path| !path.is_empty()) else {
        return Ok(None);
    };
    if let Some((id, NodeKind::Dir, _)) = placed.get(path) {
        return Ok(Some(id.clone()));
    }
    let parent = ensure_dir(live, placed, parent_of(path))?;
    let id = live
        .doc_mut()
        .add_node(parent.as_deref(), name_of(path), NodeKind::Dir, None, "")?;
    placed.insert(path.to_owned(), (id.clone(), NodeKind::Dir, None));
    Ok(Some(id))
}

pub fn still_on_disk(root: &Path, path: &str, hash: &str) -> bool {
    safe_target(root, path)
        .and_then(|target| std::fs::read(target).ok())
        .is_some_and(|bytes| sha256_hex(&bytes) == hash)
}

pub fn arrival_of(
    import: &mut LocalImport,
    placed: &Placed,
    disk: &DiskState,
    root: &Path,
    old: &str,
) -> Option<String> {
    let (_, kind, _) = placed.get(old)?;
    let known = disk.hashes.get(old)?;
    let arrived = |path: &str, hash: &str| {
        hash == known && !placed.contains_key(path) && still_on_disk(root, path, hash)
    };
    match kind {
        NodeKind::Text => import
            .texts
            .iter()
            .position(|(path, _, hash)| arrived(path, hash))
            .map(|index| import.texts.remove(index).0),
        NodeKind::Blob => import
            .blobs
            .iter()
            .position(|(path, hash, _)| arrived(path, hash))
            .map(|index| import.blobs.remove(index).0),
        NodeKind::Dir => None,
    }
}
