use std::collections::HashMap;
use std::path::Path;

use oleafly_collab::doc::{FileNode, NodeKind};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;

pub use oleafly_live::live::import::*;

use super::bases::{merged_onto, WrittenTexts};
use super::kept;
use crate::collab::disk::{follow_layout, moved_key, rekey_moved, DiskState, FoundPaths};

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
    let mut adopted = std::mem::take(&mut import.moved_dirs);
    adopted.extend(adopt_moved_files(
        live,
        disk,
        bases,
        &mut placed,
        &mut import,
        root,
    )?);
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
    adopted: &'a [(String, String)],
}

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
    for (id, now) in adopted.iter() {
        let Some(laid) = after
            .get(id)
            .filter(|placed| placed.kind == NodeKind::Dir && placed.path != *now)
            .map(|placed| placed.path.as_str())
        else {
            continue;
        };
        for placed in disk.layout.values_mut() {
            if let Some(moved) = moved_key(&placed.path, now, laid) {
                placed.path = moved;
            }
        }
    }
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
        let Some(new) = arrival_of(import, placed, disk, root, &old) else {
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
