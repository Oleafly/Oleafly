use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::{write_atomic, CollabError};
use serde::{Deserialize, Serialize};

use super::bases::Bases;
use super::{by_path, guard, writable, LiveDisk, LocalImport, WrittenTexts};
use crate::disk::{safe_target, DiskState};

pub const NOTICES_FILE: &str = "removed-notices.json";
static NOTICES: Mutex<()> = Mutex::new(());
static ANNOUNCED: LazyLock<Mutex<HashMap<PathBuf, BTreeSet<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedFile {
    pub path: String,
    pub id: String,
    pub kind: NodeKind,
    pub by: Option<String>,
    pub yours: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedPayload {
    pub project_id: String,
    pub files: Vec<RemovedFile>,
    pub restored: Vec<String>,
}

pub fn forget_announced(root: &Path) {
    guard(&ANNOUNCED).remove(root);
}

pub fn covers(parent: &str, path: &str) -> bool {
    path == parent
        || path
            .strip_prefix(parent)
            .is_some_and(|rest| rest.starts_with('/'))
}

pub fn moved_to(from: &str, to: &str, path: &str) -> String {
    format!("{to}{}", &path[from.len()..])
}

pub fn on_disk(
    disk: &DiskState,
    live: &LiveProject,
    path: &str,
) -> Result<Option<String>, CollabError> {
    if let Some((id, _)) = disk.layout.iter().find(|(_, placed)| placed.path == path) {
        if live.doc().contains(id) {
            return Ok(Some(id.clone()));
        }
    }
    Ok(by_path(&materialize::layout(&live.doc().nodes()?))
        .get(path)
        .map(|(id, _, _)| id.clone()))
}

pub fn paths_under(disk: &DiskState, path: &str) -> BTreeSet<String> {
    disk.layout
        .values()
        .map(|placed| placed.path.clone())
        .chain(disk.hashes.keys().cloned())
        .chain(std::iter::once(path.to_owned()))
        .filter(|known| covers(path, known))
        .collect()
}

pub fn forget_under(disk: &mut DiskState, bases: &mut WrittenTexts, path: &str) {
    disk.layout.retain(|_, placed| !covers(path, &placed.path));
    disk.hashes.retain(|known, _| !covers(path, known));
    bases.texts.retain(|known, _| !covers(path, known));
}

pub fn arrived_paths(import: &LocalImport) -> BTreeSet<String> {
    import
        .texts
        .iter()
        .map(|(path, _, _)| path.clone())
        .chain(import.blobs.iter().map(|(path, _, _)| path.clone()))
        .collect()
}

pub fn outermost_gone_dirs(
    import: &LocalImport,
    placed: &HashMap<String, (String, NodeKind, Option<String>)>,
) -> Vec<String> {
    let gone: Vec<String> = import
        .removed
        .iter()
        .filter(|path| matches!(placed.get(*path), Some((_, NodeKind::Dir, _))))
        .cloned()
        .collect();
    gone.iter()
        .filter(|dir| !gone.iter().any(|other| other != *dir && covers(other, dir)))
        .cloned()
        .collect()
}

pub fn folder_arrival(
    dirs: &[String],
    arrived: &BTreeSet<String>,
    disk: &DiskState,
    old: &str,
) -> Option<String> {
    let inside: Vec<String> = disk
        .hashes
        .keys()
        .filter(|path| covers(old, path) && *path != old)
        .map(|path| path[old.len() + 1..].to_owned())
        .collect();
    if inside.is_empty() {
        return None;
    }
    let candidates: Vec<&String> = dirs
        .iter()
        .filter(|new| {
            !covers(old, new)
                && inside
                    .iter()
                    .all(|relative| arrived.contains(&format!("{new}/{relative}")))
        })
        .collect();
    match candidates.as_slice() {
        [new] => Some((*new).clone()),
        _ => None,
    }
}

pub fn took_folder_move(import: &mut LocalImport, disk: &DiskState, old: &str, new: &str) {
    import.removed.retain(|path| !covers(old, path));
    let unchanged = |path: &str, hash: &str| {
        covers(new, path) && disk.hashes.get(path).is_some_and(|known| known == hash)
    };
    import
        .texts
        .retain(|(path, _, hash)| !unchanged(path, hash));
    import
        .blobs
        .retain(|(path, hash, _)| !unchanged(path, hash));
}

pub fn deleted_here(root: &Path, disk: &DiskState, path: &str) -> bool {
    disk.hashes.contains_key(path)
        && safe_target(root, path).is_some_and(|target| std::fs::symlink_metadata(target).is_err())
}

#[derive(Default)]
pub struct RemovedFirst {
    pub gone: Vec<String>,
    pub conflicts: Vec<String>,
}

pub fn remove_files_first(
    root: &Path,
    disk: &mut DiskState,
    bases: &mut impl Bases,
    removed: &mut Vec<String>,
) -> RemovedFirst {
    let mut first = RemovedFirst::default();
    let files: BTreeSet<String> = disk
        .layout
        .values()
        .filter(|placed| placed.kind != NodeKind::Dir)
        .map(|placed| placed.path.clone())
        .collect();
    removed.retain(|path| {
        if !files.contains(path) {
            return true;
        }
        if writable(root, disk, path) {
            crate::disk::remove_path(root, path);
            disk.hashes.remove(path);
            bases.forget(path);
            first.gone.push(path.clone());
        } else {
            first.conflicts.push(path.clone());
        }
        false
    });
    first
}

pub fn remembered(file: &Path) -> Vec<RemovedFile> {
    std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn keep_remembered(file: &Path, notices: &[RemovedFile]) -> Result<(), String> {
    let written = if notices.is_empty() {
        match std::fs::remove_file(file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        }
    } else {
        serde_json::to_vec(notices)
            .map_err(|error| error.to_string())
            .and_then(|json| write_atomic(file, &json).map_err(|error| error.to_string()))
    };
    written.map_err(|error| {
        format!(
            "Live collaboration could not keep the deleted-file notices in {}: {error}",
            file.display()
        )
    })
}

pub fn remember_lost(file: &Path, payload: &RemovedPayload) -> Result<(), String> {
    let lost: Vec<&RemovedFile> = payload.files.iter().filter(|file| file.yours).collect();
    if lost.is_empty() {
        return Ok(());
    }
    let _turn = guard(&NOTICES);
    let mut notices = remembered(file);
    notices.retain(|known| !lost.iter().any(|gone| gone.id == known.id));
    notices.extend(lost.into_iter().cloned());
    keep_remembered(file, &notices)
}

fn forget_notices(file: &Path, ids: &BTreeSet<String>) -> Result<(), String> {
    let _turn = guard(&NOTICES);
    let mut notices = remembered(file);
    let before = notices.len();
    notices.retain(|known| !ids.contains(&known.id));
    if notices.len() == before {
        return Ok(());
    }
    keep_remembered(file, &notices)
}

pub fn forget_notice(file: &Path, id: &str) -> Result<(), String> {
    forget_notices(file, &BTreeSet::from([id.to_owned()]))
}

impl LiveDisk {
    pub fn notices_file(&self) -> PathBuf {
        self.disk_file.with_file_name(NOTICES_FILE)
    }

    pub fn tell_removed(&self, previous: &Layout, told: Option<RemovedPayload>) {
        let back = self.came_back(previous, told.as_ref());
        if let Some(payload) = &told {
            if let Err(line) = remember_lost(&self.notices_file(), payload) {
                self.log(line);
            }
        }
        if !back.is_empty() {
            if let Err(line) = forget_notices(&self.notices_file(), &back) {
                self.log(line);
            }
        }
        let payload = match told {
            Some(payload) => Some(payload),
            None if !back.is_empty() => Some(RemovedPayload {
                project_id: self.project_id.clone(),
                files: Vec::new(),
                restored: Vec::new(),
            }),
            None => None,
        };
        if let Some(mut payload) = payload {
            payload.restored = back.into_iter().collect();
            self.host.removed(payload);
        }
    }

    fn came_back(&self, previous: &Layout, told: Option<&RemovedPayload>) -> BTreeSet<String> {
        let appeared: BTreeSet<String> = guard(&self.disk)
            .layout
            .keys()
            .filter(|id| !previous.contains_key(*id))
            .cloned()
            .collect();
        let mut announced = guard(&ANNOUNCED);
        let known = announced.entry(self.root.clone()).or_default();
        let mut back = BTreeSet::new();
        if !appeared.is_empty() {
            let saved: BTreeSet<String> = remembered(&self.notices_file())
                .into_iter()
                .map(|notice| notice.id)
                .collect();
            back = appeared
                .into_iter()
                .filter(|id| known.contains(id) || saved.contains(id))
                .collect();
            known.retain(|id| !back.contains(id));
        }
        if let Some(payload) = told {
            known.extend(payload.files.iter().map(|file| file.id.clone()));
        }
        back
    }

    pub fn note_own(&self, path: &str, present: bool) {
        let Some(target) = safe_target(&self.root, path) else {
            return;
        };
        if present {
            oleafly_core::own_writes::note_write(&target);
        } else {
            oleafly_core::own_writes::note_removal(&target);
        }
    }
}
