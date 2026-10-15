use std::collections::BTreeSet;
use std::path::Path;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;

use super::bases::WrittenTexts;
use super::moves;
use super::unwritten::{reason_of, UnwrittenReason};
use crate::collab::disk::{
    crlf_only, exists_exact, move_path, remove_path, safe_target, same_file, sha256_hex, stamp_of,
    with_line_endings, write_file_over, DiskState, Stamp, WriteOutcome,
};

pub(super) fn writable(root: &Path, disk: &DiskState, path: &str) -> bool {
    checked(root, disk, path).is_some()
}

pub(super) fn checked(root: &Path, disk: &DiskState, path: &str) -> Option<Option<Stamp>> {
    inspected(root, disk, path).map(|(stamp, _)| stamp)
}

fn inspected(root: &Path, disk: &DiskState, path: &str) -> Option<(Option<Stamp>, Option<bool>)> {
    let target = safe_target(root, path)?;
    let stamp = stamp_of(&target);
    match std::fs::read(&target) {
        Err(_) => Some((None, None)),
        Ok(bytes) => disk
            .hashes
            .get(path)
            .is_some_and(|known| *known == sha256_hex(&bytes))
            .then(|| (stamp, crlf_only(&bytes))),
    }
}

pub(super) struct DiskPass {
    pub(super) changed: BTreeSet<String>,
    pub(super) conflicts: Vec<String>,
    pub(super) blobs: Vec<(String, String)>,
    pub(super) moved: Vec<(String, String)>,
    pub(super) removed: Vec<String>,
    pub(super) written: BTreeSet<String>,
    pub(super) done: BTreeSet<String>,
    pub(super) failed: Vec<(String, UnwrittenReason)>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn apply_to_disk(
    root: &Path,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    mut plan: materialize::DiskPlan,
    next: Layout,
    texts: &[(String, String)],
    crlf: &BTreeSet<String>,
    blocked: &dyn Fn(&str) -> bool,
) -> Result<DiskPass, CollabError> {
    let mut conflicts: Vec<String> = Vec::new();
    let mut changed: BTreeSet<String> = BTreeSet::new();
    let mut written: BTreeSet<String> = BTreeSet::new();
    let mut done: BTreeSet<String> = BTreeSet::new();
    let mut failed: Vec<(String, UnwrittenReason)> = Vec::new();
    let mut gone: Vec<String> = Vec::new();
    alias_case_renames(root, &disk.layout, &next, &mut plan);
    let first = moves::remove_files_first(root, disk, bases, &mut plan.removed);
    conflicts.extend(first.conflicts);
    changed.extend(first.gone.iter().cloned());
    gone.extend(first.gone);
    let renamed = move_planned(root, disk, bases, &plan.moved, &mut changed);
    for dir in &plan.dirs {
        if let Some(target) = safe_target(root, dir) {
            let _ = std::fs::create_dir_all(target);
            changed.insert(dir.clone());
        }
    }
    for (path, text) in texts {
        if moves::deleted_here(root, disk, path) {
            conflicts.push(path.clone());
            continue;
        }
        let Some((stamp, style)) = inspected(root, disk, path) else {
            conflicts.push(path.clone());
            continue;
        };
        let bytes = with_line_endings(text, style.unwrap_or_else(|| crlf.contains(path)));
        match write_file_over(root, path, &bytes, stamp.as_ref()) {
            Ok(WriteOutcome::ChangedOutside) => {
                conflicts.push(path.clone());
                continue;
            }
            Ok(WriteOutcome::Written) => {
                changed.insert(path.clone());
                written.insert(path.clone());
            }
            Ok(WriteOutcome::Same) => {}
            Err(error) => {
                failed.push((path.clone(), reason_of(root, path, &error)));
                continue;
            }
        }
        disk.hashes.insert(path.clone(), sha256_hex(&bytes));
        bases.record(path, text);
        done.insert(path.clone());
    }
    let blobs = blobs_to_fetch(root, disk, &next, blocked, &mut conflicts);
    for path in &plan.removed {
        if !writable(root, disk, path) {
            conflicts.push(path.clone());
            continue;
        }
        remove_path(root, path);
        disk.hashes.remove(path);
        bases.forget(path);
        changed.insert(path.clone());
        gone.push(path.clone());
    }
    disk.layout = next;
    let removed: Vec<String> = gone
        .iter()
        .filter(|path| {
            !gone
                .iter()
                .any(|parent| path.starts_with(&format!("{parent}/")))
        })
        .cloned()
        .collect();
    Ok(DiskPass {
        changed,
        conflicts,
        blobs,
        moved: renamed,
        removed,
        written,
        done,
        failed,
    })
}

fn alias_case_renames(
    root: &Path,
    before: &Layout,
    next: &Layout,
    plan: &mut materialize::DiskPlan,
) {
    let mut aliased = Vec::new();
    plan.removed.retain(|path| {
        match next
            .iter()
            .find(|(id, placed)| !before.contains_key(*id) && same_file(root, path, &placed.path))
            .map(|(_, placed)| placed)
        {
            Some(placed) => {
                aliased.push((path.clone(), placed.path.clone()));
                false
            }
            None => true,
        }
    });
    plan.moved.extend(aliased);
    plan.moved
        .sort_by_key(|(from, _)| from.matches('/').count());
}

fn move_planned(
    root: &Path,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    moved: &[(String, String)],
    changed: &mut BTreeSet<String>,
) -> Vec<(String, String)> {
    let mut renamed: Vec<(String, String)> = Vec::new();
    for (from, to) in moved {
        let moved =
            move_path(root, from, to) || (!exists_exact(root, from) && exists_exact(root, to));
        if !moved {
            continue;
        }
        if !renamed
            .iter()
            .any(|(parent, _): &(String, String)| from.starts_with(&format!("{parent}/")))
        {
            renamed.push((from.clone(), to.clone()));
        }
        if let Some(hash) = disk.hashes.remove(from) {
            disk.hashes.insert(to.clone(), hash);
        }
        bases.rename(from, to);
        changed.insert(from.clone());
        changed.insert(to.clone());
    }
    renamed
}

pub(super) enum FigureState {
    OnDisk,
    Conflict,
    Missing(Option<Stamp>),
}

pub(super) fn figure_state(root: &Path, disk: &DiskState, path: &str, hash: &str) -> FigureState {
    let on_disk = safe_target(root, path)
        .and_then(|target| std::fs::read(target).ok())
        .is_some_and(|bytes| sha256_hex(&bytes) == hash);
    if on_disk {
        FigureState::OnDisk
    } else if moves::deleted_here(root, disk, path) {
        FigureState::Conflict
    } else {
        checked(root, disk, path).map_or(FigureState::Conflict, FigureState::Missing)
    }
}

fn blobs_to_fetch(
    root: &Path,
    disk: &mut DiskState,
    next: &Layout,
    blocked: &dyn Fn(&str) -> bool,
    conflicts: &mut Vec<String>,
) -> Vec<(String, String)> {
    let mut blobs = Vec::new();
    for placed in next.values().filter(|placed| placed.kind == NodeKind::Blob) {
        let Some(hash) = &placed.blob else {
            continue;
        };
        if disk.hashes.get(&placed.path) == Some(hash) || blocked(&placed.path) {
            continue;
        }
        match figure_state(root, disk, &placed.path, hash) {
            FigureState::OnDisk => {
                disk.hashes.insert(placed.path.clone(), hash.clone());
            }
            FigureState::Conflict => conflicts.push(placed.path.clone()),
            FigureState::Missing(_) => blobs.push((placed.path.clone(), hash.clone())),
        }
    }
    blobs
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use oleafly_collab::doc::ProjectDoc;

    use super::*;

    #[test]
    fn a_figure_that_never_reached_disk_is_fetched_on_any_later_pass() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut doc = ProjectDoc::create().unwrap();
        for name in ["late.png", "removed.png", "held.png", "here.png"] {
            doc.add_node(
                None,
                name,
                NodeKind::Blob,
                Some(&sha256_hex(name.as_bytes())),
                "",
            )
            .unwrap();
        }
        let layout = materialize::layout(&doc.nodes().unwrap());
        std::fs::write(root.join("here.png"), b"here.png").unwrap();
        let mut disk = DiskState {
            layout: layout.clone(),
            hashes: BTreeMap::from([("removed.png".to_owned(), sha256_hex(b"removed.png"))]),
        };
        let pass = apply_to_disk(
            root,
            &mut disk,
            &mut WrittenTexts::default(),
            materialize::plan(&layout, &layout),
            layout.clone(),
            &[],
            &BTreeSet::new(),
            &|path| path == "held.png",
        )
        .unwrap();
        let fetched: Vec<&str> = pass.blobs.iter().map(|(path, _)| path.as_str()).collect();
        assert_eq!(fetched, ["late.png"]);
        assert_eq!(disk.hashes.get("here.png"), Some(&sha256_hex(b"here.png")));
        assert!(pass.conflicts.is_empty(), "{:?}", pass.conflicts);
    }
}
