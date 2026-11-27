use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use oleafly_collab::materialize::{DiskPlan, Layout};
use oleafly_collab::{write_atomic, CollabError};
use oleafly_core::app_log::AppLog;
use oleafly_ot::TextOperation;
use serde::{Deserialize, Serialize};

use super::moves::{covers, moved_to};
use super::session::io;
use super::{LocalImport, WrittenTexts};
use crate::disk::{exists_exact, read_text, sha256_hex, written_as, DiskState};

const HOLD_FILE: &str = "sync-hold.json";
const KEPT_DIR: &str = "sync-kept";

static HOLD_LOCK: Mutex<()> = Mutex::new(());

pub fn hold_lock() -> MutexGuard<'static, ()> {
    HOLD_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pending {
    pub changed: usize,
    pub total: usize,
    #[serde(default)]
    pub everything: bool,
    #[serde(default)]
    pub paths: BTreeSet<String>,
}

impl Pending {
    pub fn holds(&self, path: &str) -> bool {
        self.everything || self.paths.iter().any(|held| covers(held, path))
    }

    pub fn pins(&self, path: &str) -> bool {
        self.holds(path) || self.paths.iter().any(|held| covers(path, held))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kept {
    Text,
    Blob,
    Added,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeptText {
    pub doc: String,
    pub disk: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hold {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<Pending>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub kept: BTreeMap<String, Kept>,
}

pub fn kept_file(dir: &Path, path: &str) -> PathBuf {
    dir.join(KEPT_DIR)
        .join(format!("{}.json", sha256_hex(path.as_bytes())))
}

pub fn load_text(dir: &Path, path: &str) -> Option<KeptText> {
    std::fs::read(kept_file(dir, path))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

pub fn store_text(dir: &Path, path: &str, text: &KeptText) -> Result<(), CollabError> {
    let json = serde_json::to_vec(text).map_err(|error| CollabError::Corrupt(error.to_string()))?;
    write_atomic(&kept_file(dir, path), &json)
}

impl Hold {
    pub fn load(dir: &Path) -> Hold {
        std::fs::read(dir.join(HOLD_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> Result<(), CollabError> {
        let file = dir.join(HOLD_FILE);
        if self.pending.is_none() && self.kept.is_empty() {
            return match std::fs::remove_file(&file) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io(error)),
                _ => Ok(()),
            };
        }
        let json =
            serde_json::to_vec(self).map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(&file, &json)
    }

    pub fn is_quiet(&self) -> bool {
        self.pending.is_none() && self.kept.is_empty()
    }

    pub fn holds(&self, path: &str) -> bool {
        self.pending
            .as_ref()
            .is_some_and(|pending| pending.holds(path))
    }

    pub fn pins(&self, path: &str) -> bool {
        self.pending
            .as_ref()
            .is_some_and(|pending| pending.pins(path))
    }

    pub fn kind(&self, path: &str) -> Option<Kept> {
        self.kept.get(path).copied()
    }

    pub fn forget(&mut self, dir: &Path, path: &str) {
        if self.kept.remove(path) == Some(Kept::Text) {
            let _ = std::fs::remove_file(kept_file(dir, path));
        }
    }

    pub fn rekey(&mut self, dir: &Path, from: &str, to: &str) {
        let moved: Vec<String> = self
            .kept
            .keys()
            .filter(|path| covers(from, path))
            .cloned()
            .collect();
        for old in moved {
            let new = moved_to(from, to, &old);
            let Some(kind) = self.kept.remove(&old) else {
                continue;
            };
            if kind == Kept::Text {
                if let Some(text) = load_text(dir, &old) {
                    let _ = store_text(dir, &new, &text);
                }
                let _ = std::fs::remove_file(kept_file(dir, &old));
            }
            self.kept.insert(new, kind);
        }
        if let Some(pending) = self.pending.as_mut() {
            let moved: Vec<String> = pending
                .paths
                .iter()
                .filter(|path| covers(from, path))
                .cloned()
                .collect();
            for old in moved {
                pending.paths.remove(&old);
                pending.paths.insert(moved_to(from, to, &old));
            }
        }
    }
}

pub fn rebase(base: &str, changed: &str, onto: &str) -> Option<TextOperation> {
    oleafly_ot::rebase(base, changed, onto).map(|rebased| rebased.operation)
}

pub fn recorded(bases: &WrittenTexts, disk: &DiskState, path: &str) -> Option<String> {
    let known = disk.hashes.get(path)?;
    bases
        .kept(path)
        .find(|text| written_as(text, known))
        .cloned()
}

pub struct KeptEdit {
    pub path: String,
    pub text: String,
    pub hash: String,
    pub kept: KeptText,
}

pub fn screen(
    dir: &Path,
    root: &Path,
    disk: &DiskState,
    import: &mut LocalImport,
) -> Result<Vec<KeptEdit>, CollabError> {
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    if hold.is_quiet() {
        return Ok(Vec::new());
    }
    let before = hold.clone();
    if let Some(pending) = &hold.pending {
        import.texts.retain(|(path, _, _)| !pending.holds(path));
        import.blobs.retain(|(path, _, _)| !pending.holds(path));
        import.removed.retain(|path| !pending.holds(path));
        import.dirs.retain(|path| !pending.holds(path));
    }
    hold.kept
        .retain(|path, kind| *kind != Kept::Added || exists_exact(root, path));
    let mut edits = Vec::new();
    let mut texts = Vec::new();
    for (path, text, hash) in std::mem::take(&mut import.texts) {
        match hold.kind(&path) {
            None => texts.push((path, text, hash)),
            Some(Kept::Added) => {}
            Some(Kept::Text) => {
                if let Some(kept) = load_text(dir, &path) {
                    edits.push(KeptEdit {
                        path,
                        text,
                        hash,
                        kept,
                    });
                }
            }
            Some(Kept::Blob | Kept::Removed) => {
                hold.forget(dir, &path);
                texts.push((path, text, hash));
            }
        }
    }
    import.texts = texts;
    let mut blobs = Vec::new();
    for (path, hash, size) in std::mem::take(&mut import.blobs) {
        match hold.kind(&path) {
            Some(Kept::Added) => {}
            Some(_) => {
                hold.forget(dir, &path);
                blobs.push((path, hash, size));
            }
            None => blobs.push((path, hash, size)),
        }
    }
    import.blobs = blobs;
    let mut removed = Vec::new();
    for path in std::mem::take(&mut import.removed) {
        match hold.kind(&path) {
            None => removed.push(path),
            Some(Kept::Text | Kept::Blob) => {
                let renamed = disk.hashes.get(&path).and_then(|known| {
                    import
                        .texts
                        .iter()
                        .map(|(new, _, hash)| (new, hash))
                        .chain(import.blobs.iter().map(|(new, hash, _)| (new, hash)))
                        .find(|(_, hash)| *hash == known)
                        .map(|(new, _)| new.clone())
                });
                match renamed {
                    Some(new) => hold.rekey(dir, &path, &new),
                    None => hold.forget(dir, &path),
                }
                removed.push(path);
            }
            Some(Kept::Added | Kept::Removed) => {}
        }
    }
    import.removed = removed;
    import
        .dirs
        .retain(|path| hold.kind(path) != Some(Kept::Added));
    if hold != before {
        hold.save(dir)?;
    }
    Ok(edits)
}

pub fn release_kept(
    dir: &Path,
    edits: Vec<KeptEdit>,
    log: &AppLog,
) -> Vec<(String, String, String, String)> {
    if edits.is_empty() {
        return Vec::new();
    }
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    let released = edits
        .into_iter()
        .map(|edit| {
            hold.forget(dir, &edit.path);
            (edit.path, edit.text, edit.hash, edit.kept.disk)
        })
        .collect();
    if let Err(error) = hold.save(dir) {
        let _ = log.write(&format!(
            "Live editing could not update the held changes in {}: {error}",
            dir.display()
        ));
    }
    released
}

#[derive(Default)]
pub struct Shaped {
    pub conflicts: Vec<String>,
    pub merged: Vec<(String, KeptText)>,
    pub held: Option<Hold>,
}

impl Shaped {
    pub fn blocks(&self, path: &str) -> bool {
        self.held
            .as_ref()
            .is_some_and(|hold| hold.holds(path) || hold.kind(path).is_some())
    }

    pub fn pins(&self, path: &str) -> bool {
        self.held.as_ref().is_some_and(|hold| hold.pins(path))
    }
}

pub fn keeps_back(dir: &Path, path: &str) -> bool {
    let _lock = hold_lock();
    let hold = Hold::load(dir);
    hold.holds(path) || hold.kind(path).is_some()
}

pub fn shape(
    dir: &Path,
    root: &Path,
    plan: &mut DiskPlan,
    texts: &mut Vec<(String, String)>,
    next: &Layout,
) -> Shaped {
    let mut shaped = Shaped::default();
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    if hold.is_quiet() {
        return shaped;
    }
    let before = hold.clone();
    for (from, to) in &plan.moved {
        if hold.pins(from) || hold.pins(to) {
            continue;
        }
        hold.rekey(dir, from, to);
    }
    let mut removed = Vec::new();
    for path in std::mem::take(&mut plan.removed) {
        if hold.holds(&path) {
            continue;
        }
        match hold.kind(&path) {
            None => removed.push(path),
            Some(Kept::Removed) => hold.forget(dir, &path),
            Some(Kept::Text | Kept::Blob) => {
                hold.forget(dir, &path);
                hold.kept.insert(path, Kept::Added);
            }
            Some(Kept::Added) => {}
        }
    }
    plan.removed = removed;
    plan.written.retain(|id| {
        next.get(id)
            .is_none_or(|placed| !hold.holds(&placed.path) && hold.kind(&placed.path).is_none())
    });
    let mut kept = Vec::new();
    for (path, text) in std::mem::take(texts) {
        if hold.holds(&path) {
            continue;
        }
        match hold.kind(&path) {
            None => kept.push((path, text)),
            Some(Kept::Text) => {
                let Some(base) = load_text(dir, &path) else {
                    continue;
                };
                if read_text(root, &path).map(|(text, _)| text).as_deref()
                    != Some(base.disk.as_str())
                {
                    shaped.conflicts.push(path);
                    continue;
                }
                if base.doc == text {
                    continue;
                }
                let Some(merged) = rebase(&base.doc, &text, &base.disk)
                    .and_then(|operation| operation.apply(&base.disk).ok())
                else {
                    continue;
                };
                shaped.merged.push((
                    path.clone(),
                    KeptText {
                        doc: text,
                        disk: merged.clone(),
                    },
                ));
                kept.push((path, merged));
            }
            Some(_) => {}
        }
    }
    *texts = kept;
    if hold != before {
        let _ = hold.save(dir);
    }
    shaped.held = Some(hold);
    shaped
}

pub fn settle(dir: &Path, shaped: Shaped, conflicts: &[String]) {
    if shaped.merged.is_empty() {
        return;
    }
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    for (path, text) in shaped.merged {
        if conflicts.contains(&path) || hold.kind(&path) != Some(Kept::Text) {
            continue;
        }
        if text.doc == text.disk {
            hold.forget(dir, &path);
        } else {
            let _ = store_text(dir, &path, &text);
        }
    }
    let _ = hold.save(dir);
}
