use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use oleafly_collab::doc::{FileNode, NodeKind};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;

use super::bases::{merged_onto, WrittenTexts};
use super::kept;
use super::session::io;
use crate::collab::disk::{
    as_text, crlf_only, excluded_name, exists_exact, follow_layout, inside, rekey_moved,
    safe_target, scan_folder, scan_folder_within, sha256_hex, DiskState, FoundPaths, ShareRules,
};

pub(super) fn parent_of(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _)| parent)
}

pub(super) fn name_of(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

pub(super) fn by_path(layout: &Layout) -> HashMap<String, (String, NodeKind, Option<String>)> {
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
pub(super) struct LocalImport {
    pub(super) texts: Vec<(String, String, String)>,
    pub(super) blobs: Vec<(String, String, u64)>,
    pub(super) removed: Vec<String>,
    pub(super) dirs: Vec<String>,
    pub(super) restamped: Vec<(String, String)>,
    pub(super) crlf: BTreeSet<String>,
}

impl LocalImport {
    pub(super) fn is_empty(&self) -> bool {
        self.texts.is_empty()
            && self.blobs.is_empty()
            && self.removed.is_empty()
            && self.dirs.is_empty()
            && self.restamped.is_empty()
    }
}

pub(super) type Placed = HashMap<String, (String, NodeKind, Option<String>)>;

pub(super) struct Scanned {
    import: LocalImport,
    known_texts: Vec<(String, String, String, String)>,
}

impl Scanned {
    pub(super) fn classify(self, live: &LiveProject) -> LocalImport {
        let mut import = self.import;
        for (path, id, text, hash) in self.known_texts {
            if live.doc().text(&id).ok().as_deref() == Some(text.as_str()) {
                import.restamped.push((path, hash));
            } else {
                import.texts.push((path, text, hash));
            }
        }
        import
    }
}

pub(super) fn placed_now(live: &LiveProject) -> Result<Placed, CollabError> {
    Ok(by_path(&materialize::layout(&live.doc().nodes()?)))
}

pub(super) fn read_local_changes(
    root: &Path,
    disk: &DiskState,
    live: &LiveProject,
    only: Option<&[String]>,
) -> Result<LocalImport, CollabError> {
    let placed = placed_now(live)?;
    Ok(scan_local(root, disk, &placed, only)?.classify(live))
}

pub(super) fn scan_local(
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

#[cfg(test)]
pub(super) type ReadHook = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

#[cfg(test)]
pub(super) static BEFORE_READ: std::sync::Mutex<Option<ReadHook>> = std::sync::Mutex::new(None);

fn read_changed_file(
    scanned: &mut Scanned,
    disk: &DiskState,
    target: &Path,
    path: String,
    known: Option<&(String, NodeKind, Option<String>)>,
) -> Result<(), CollabError> {
    #[cfg(test)]
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

pub(super) fn ensure_dir(
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

#[cfg(test)]
pub(super) fn apply_local_import(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    import: LocalImport,
    root: &Path,
) -> Result<bool, CollabError> {
    Ok(import_renaming(live, disk, bases, import, root)?.0)
}

pub(super) type Renamed = Vec<(String, String)>;

// Imports like apply_local_import and also returns the files it renamed on
// disk to the names the layout gave them.
pub(super) fn import_renaming(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    import: LocalImport,
    root: &Path,
) -> Result<(bool, Renamed), CollabError> {
    let before = materialize::layout(&live.doc().nodes()?);
    let mut placed = by_path(&before);
    let mut import = import;
    let adopted = adopt_moved_files(live, disk, bases, &mut placed, &mut import, root)?;
    let mut changed = !adopted.is_empty();
    for path in import.dirs {
        ensure_dir(live, &mut placed, Some(&path))?;
        changed = true;
    }
    let mut beside = Vec::new();
    for (path, text, hash) in import.texts {
        if !still_on_disk(root, &path, &hash) {
            continue;
        }
        match placed.get(&path).cloned() {
            Some((theirs, NodeKind::Text, _))
                if kept::take_replaced_arrival(
                    root,
                    live,
                    bases.latest(&path).map(String::as_str),
                    &path,
                    &theirs,
                    &text,
                ) =>
            {
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                let ours = live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
                live.doc_mut()
                    .set_crlf(&ours, import.crlf.contains(&path))?;
                beside.push((ours, theirs, path.clone()));
                changed = true;
            }
            Some((id, NodeKind::Text, _)) => {
                let current = live.doc().text(&id)?;
                let merged = bases
                    .base_for(&path, &text)
                    .and_then(|base| merged_onto(base, &text, &current));
                changed |= match merged {
                    Some(operation) => live.local_operation(&id, &operation)?,
                    None => live.local_text(&id, &text)?,
                };
                if live.doc().text(&id)? != text {
                    live.mark_dirty(&id);
                    changed = true;
                }
            }
            Some((id, _, _)) => {
                live.doc_mut().trash(&id)?;
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                let id = live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
                live.doc_mut().set_crlf(&id, import.crlf.contains(&path))?;
                changed = true;
            }
            None => {
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                let id = live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
                live.doc_mut().set_crlf(&id, import.crlf.contains(&path))?;
                placed.insert(path.clone(), (id, NodeKind::Text, None));
                changed = true;
            }
        }
        bases.record(&path, &text);
        disk.hashes.insert(path, hash);
    }
    for (path, hash) in import.restamped {
        if still_on_disk(root, &path, &hash) {
            disk.hashes.insert(path, hash);
        }
    }
    changed |= import_blobs(live, disk, &mut placed, import.blobs, root, &mut beside)?;
    for path in import.removed {
        if let Some((id, _, _)) = placed.get(&path) {
            live.doc_mut().trash(id)?;
            disk.hashes.remove(&path);
            changed = true;
        }
    }
    let mut renamed = Vec::new();
    if changed {
        let nodes = live.doc().nodes()?;
        let after = materialize::layout(&nodes);
        let new_names = NewNames {
            before: &before,
            after: &after,
            beside: &beside,
            adopted: &adopted,
        };
        renamed = follow_new_names(root, disk, bases, &nodes, &new_names);
        record_local_change(&mut disk.layout, &before, &after);
        crate::collab::tree::keep_beside(&mut disk.layout, beside);
    }
    Ok((changed, renamed))
}

struct NewNames<'a> {
    before: &'a Layout,
    after: &'a Layout,
    beside: &'a [(String, String, String)],
    // Nodes moved to follow a file moved on disk, with where it is now.
    adopted: &'a [(String, String)],
}

// Moves each file and folder this import added, or moved to follow a move
// on disk, to the path the layout gives its node.
fn follow_new_names(
    root: &Path,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    nodes: &[FileNode],
    names: &NewNames<'_>,
) -> Renamed {
    let NewNames {
        before,
        after,
        beside,
        adopted,
    } = names;
    let mut found = FoundPaths::new(nodes, before);
    let mut node_at: HashMap<String, String> = HashMap::new();
    let mut wanted: Vec<(String, String)> = after
        .iter()
        .filter(|(id, _)| {
            !before.contains_key(*id) && !beside.iter().any(|(ours, _, _)| ours == *id)
        })
        .filter_map(|(id, placed)| {
            node_at.insert(placed.path.clone(), id.clone());
            Some((found.path(id)?, placed.path.clone()))
        })
        .collect();
    for (id, now) in adopted.iter() {
        if let Some(placed) = after.get(id) {
            node_at.insert(placed.path.clone(), id.clone());
            wanted.push((now.clone(), placed.path.clone()));
        }
    }
    let followed = follow_layout(root, wanted);
    for (from, to) in &followed.moved {
        for (old, new) in rekey_moved(&mut disk.hashes, from, to) {
            bases.rename(&old, &new);
        }
    }
    for (from, to) in followed.failed {
        if let Some(id) = node_at.remove(&to) {
            disk.owed.insert(from, id);
        }
    }
    followed.moved
}

fn still_on_disk(root: &Path, path: &str, hash: &str) -> bool {
    safe_target(root, path)
        .and_then(|target| std::fs::read(target).ok())
        .is_some_and(|bytes| sha256_hex(&bytes) == hash)
}

// Moves the node of each file moved on disk to where it went, and returns
// each node moved with its new path.
fn adopt_moved_files(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    placed: &mut HashMap<String, (String, NodeKind, Option<String>)>,
    import: &mut LocalImport,
    root: &Path,
) -> Result<Vec<(String, String)>, CollabError> {
    let mut adopted = Vec::new();
    for old in import.removed.clone() {
        let Some((id, kind, blob)) = placed.get(&old).cloned() else {
            continue;
        };
        let Some(known) = disk.hashes.get(&old).cloned() else {
            continue;
        };
        let arrived = |path: &str, hash: &str| {
            hash == known && !placed.contains_key(path) && still_on_disk(root, path, hash)
        };
        let found = match kind {
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
        };
        let Some(new) = found else {
            continue;
        };
        let parent = ensure_dir(live, placed, parent_of(&new))?;
        live.doc_mut().move_to(&id, parent.as_deref())?;
        if name_of(&old) != name_of(&new) {
            live.doc_mut().rename(&id, name_of(&new))?;
        }
        placed.remove(&old);
        placed.insert(new.clone(), (id.clone(), kind, blob));
        if let Some(hash) = disk.hashes.remove(&old) {
            disk.hashes.insert(new.clone(), hash);
        }
        bases.rename(&old, &new);
        import.removed.retain(|path| *path != old);
        adopted.push((id, new));
    }
    Ok(adopted)
}

fn import_blobs(
    live: &mut LiveProject,
    disk: &mut DiskState,
    placed: &mut HashMap<String, (String, NodeKind, Option<String>)>,
    blobs: Vec<(String, String, u64)>,
    root: &Path,
    beside: &mut Vec<(String, String, String)>,
) -> Result<bool, CollabError> {
    let mut changed = false;
    for (path, hash, _) in blobs {
        if !still_on_disk(root, &path, &hash) {
            continue;
        }
        match placed.get(&path).cloned() {
            Some((id, NodeKind::Blob, _)) if disk.hashes.contains_key(&path) => {
                let seen = disk.hashes.get(&path).cloned().unwrap_or_default();
                live.doc_mut().replace_blob(&id, &seen, &hash)?
            }
            Some((theirs, NodeKind::Blob, _)) => {
                let parent = ensure_dir(live, placed, parent_of(&path))?;
                let ours = live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?;
                beside.push((ours, theirs, path.clone()));
            }
            Some((id, _, _)) => {
                live.doc_mut().trash(&id)?;
                let parent = ensure_dir(live, placed, parent_of(&path))?;
                live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?;
            }
            None => {
                let parent = ensure_dir(live, placed, parent_of(&path))?;
                live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?;
            }
        }
        disk.hashes.insert(path, hash);
        changed = true;
    }
    Ok(changed)
}

fn record_local_change(written: &mut Layout, before: &Layout, after: &Layout) {
    written.retain(|id, _| !before.contains_key(id) || after.contains_key(id));
    for (id, placed) in after {
        if before.get(id) != Some(placed) {
            written.insert(id.clone(), placed.clone());
        }
    }
}
