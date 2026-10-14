use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::sync::LiveLink;
use oleafly_collab::CollabError;

use super::bases::{merged_onto, WrittenTexts};
use super::session::io;
use super::{kept, uploads};
use crate::collab::disk::{
    as_text, crlf_only, excluded_name, exists_exact, safe_target, scan_folder, sha256_hex,
    DiskState,
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
    pub(super) blobs: Vec<(String, String, Vec<u8>)>,
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

pub(super) fn read_local_changes(
    root: &Path,
    disk: &DiskState,
    live: &LiveProject,
    only: Option<&[String]>,
) -> Result<LocalImport, CollabError> {
    let layout = materialize::layout(&live.doc().nodes()?);
    let placed = by_path(&layout);
    let candidates = match only {
        Some(paths) => named_candidates(root, &placed, paths),
        None => every_candidate(root, &placed)?,
    };
    let mut import = LocalImport::default();
    for path in candidates {
        if path.is_empty() || excluded_name(&path) {
            continue;
        }
        let Some(target) = safe_target(root, &path) else {
            continue;
        };
        let known = placed.get(&path);
        let present = if exists_exact(root, &path) {
            std::fs::symlink_metadata(&target)
        } else {
            Err(std::io::Error::from(std::io::ErrorKind::NotFound))
        };
        match present {
            Ok(metadata) if metadata.is_file() => {
                read_changed_file(&mut import, disk, live, &target, path, known)?;
            }
            Ok(metadata) if metadata.is_dir() => {
                if known.is_none() {
                    import.dirs.push(path);
                }
            }
            Ok(_) => {}
            Err(_) => note_missing(&mut import, disk, path, known),
        }
    }
    Ok(import)
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
                if let Ok(scan) = scan_folder(root) {
                    candidates.extend(
                        scan.files
                            .into_iter()
                            .map(|(file, _)| file)
                            .filter(|file| file.starts_with(&prefix)),
                    );
                    candidates.extend(scan.dirs.into_iter().filter(|dir| dir.starts_with(&prefix)));
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

fn read_changed_file(
    import: &mut LocalImport,
    disk: &DiskState,
    live: &LiveProject,
    target: &Path,
    path: String,
    known: Option<&(String, NodeKind, Option<String>)>,
) -> Result<(), CollabError> {
    let bytes = std::fs::read(target).map_err(io)?;
    let hash = sha256_hex(&bytes);
    if disk.hashes.get(&path) == Some(&hash) && known.is_some() {
        return Ok(());
    }
    let text = as_text(&bytes);
    if text.is_some() && crlf_only(&bytes) == Some(true) {
        import.crlf.insert(path.clone());
    }
    match (text, known) {
        (Some(text), Some((id, NodeKind::Text, _))) => {
            if live.doc().text(id)? != text {
                import.texts.push((path, text, hash));
            } else {
                import.restamped.push((path, hash));
            }
        }
        (Some(text), None) => import.texts.push((path, text, hash)),
        (_, Some((_, NodeKind::Blob, Some(blob)))) if *blob == hash => {}
        (None, _) | (Some(_), Some(_)) => import.blobs.push((path, hash, bytes)),
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

pub(super) fn apply_local_import(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    import: LocalImport,
    root: &Path,
) -> Result<bool, CollabError> {
    let before = materialize::layout(&live.doc().nodes()?);
    let mut placed = by_path(&before);
    let mut import = import;
    let mut changed = adopt_moved_files(live, disk, bases, &mut placed, &mut import, root)?;
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
    if changed {
        let after = materialize::layout(&live.doc().nodes()?);
        record_local_change(&mut disk.layout, &before, &after);
        crate::collab::tree::keep_beside(&mut disk.layout, beside);
    }
    Ok(changed)
}

fn still_on_disk(root: &Path, path: &str, hash: &str) -> bool {
    safe_target(root, path)
        .and_then(|target| std::fs::read(target).ok())
        .is_some_and(|bytes| sha256_hex(&bytes) == hash)
}

fn adopt_moved_files(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    placed: &mut HashMap<String, (String, NodeKind, Option<String>)>,
    import: &mut LocalImport,
    root: &Path,
) -> Result<bool, CollabError> {
    let mut changed = false;
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
        placed.insert(new.clone(), (id, kind, blob));
        if let Some(hash) = disk.hashes.remove(&old) {
            disk.hashes.insert(new.clone(), hash);
        }
        bases.rename(&old, &new);
        import.removed.retain(|path| *path != old);
        changed = true;
    }
    Ok(changed)
}

fn import_blobs(
    live: &mut LiveProject,
    disk: &mut DiskState,
    placed: &mut HashMap<String, (String, NodeKind, Option<String>)>,
    blobs: Vec<(String, String, Vec<u8>)>,
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

pub(super) async fn upload_blobs(
    link: &LiveLink,
    blobs: &[(String, String, Vec<u8>)],
) -> BTreeSet<String> {
    uploads::send(link, blobs, false).await
}
