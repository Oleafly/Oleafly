use crate::error::CollabError;
use crate::paths::write_atomic;
use oleafly_collab_protocol::ids::FileId;
use serde::{Deserialize, Serialize};
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const FORMAT_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FileIdMap {
    by_path: BTreeMap<String, FileId>,
    by_id: BTreeMap<FileId, String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReconcileReport {
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct StoredFileIds {
    version: u32,
    files: BTreeMap<String, FileId>,
}

impl FileIdMap {
    pub fn load(path: &Path) -> Result<FileIdMap, CollabError> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(FileIdMap::default())
            }
            Err(error) => {
                return Err(CollabError::Io(format!(
                    "failed to read {}: {error}",
                    path.display()
                )))
            }
        };
        let corrupt =
            |reason: String| CollabError::Corrupt(format!("{}: {reason}", path.display()));
        let stored: StoredFileIds =
            serde_json::from_slice(&bytes).map_err(|error| corrupt(error.to_string()))?;
        if stored.version != FORMAT_VERSION {
            return Err(corrupt(format!("unsupported version {}", stored.version)));
        }
        let mut map = FileIdMap::default();
        for (rel, id) in stored.files {
            if normalise(&rel).ok().as_deref() != Some(rel.as_str()) {
                return Err(corrupt(format!("invalid path {rel:?}")));
            }
            if map.by_id.insert(id, rel.clone()).is_some() {
                return Err(corrupt(format!("duplicate file id {id}")));
            }
            map.by_path.insert(rel, id);
        }
        Ok(map)
    }

    pub fn save(&self, path: &Path) -> Result<(), CollabError> {
        let stored = StoredFileIds {
            version: FORMAT_VERSION,
            files: self.by_path.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&stored)
            .map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(path, &bytes)
    }

    pub fn ensure(&mut self, rel: &str) -> Result<FileId, CollabError> {
        match self.by_path.entry(normalise(rel)?) {
            Entry::Occupied(slot) => Ok(*slot.get()),
            Entry::Vacant(slot) => {
                let id = FileId::new_v7();
                self.by_id.insert(id, slot.key().clone());
                slot.insert(id);
                Ok(id)
            }
        }
    }

    pub fn id_of(&self, rel: &str) -> Option<FileId> {
        let rel = normalise(rel).ok()?;
        self.by_path.get(&rel).copied()
    }

    pub fn path_of(&self, id: FileId) -> Option<&str> {
        self.by_id.get(&id).map(String::as_str)
    }

    pub fn rename(&mut self, from: &str, to: &str) -> Result<(), CollabError> {
        let from = normalise(from)?;
        let to = normalise(to)?;
        let Some(id) = self.by_path.get(&from).copied() else {
            return Err(CollabError::InvalidPath(format!("{from} is not tracked")));
        };
        if from == to {
            return Ok(());
        }
        if self.by_path.contains_key(&to) {
            return Err(CollabError::InvalidPath(format!("{to} is already tracked")));
        }
        self.by_path.remove(&from);
        self.by_id.insert(id, to.clone());
        self.by_path.insert(to, id);
        Ok(())
    }

    pub fn rename_dir(&mut self, from_prefix: &str, to_prefix: &str) -> Result<(), CollabError> {
        let from = format!("{}/", normalise(from_prefix)?);
        let to = format!("{}/", normalise(to_prefix)?);
        if from == to {
            return Ok(());
        }
        if to.starts_with(&from) {
            return Err(CollabError::InvalidPath(format!(
                "cannot move {from} inside itself"
            )));
        }
        let moving: Vec<(String, FileId)> = self
            .by_path
            .iter()
            .filter(|(rel, _)| rel.starts_with(&from))
            .map(|(rel, id)| (rel.clone(), *id))
            .collect();
        let mut targets = Vec::with_capacity(moving.len());
        for (rel, id) in &moving {
            let target = format!("{to}{}", &rel[from.len()..]);
            if !target.starts_with(&from) && self.by_path.contains_key(&target) {
                return Err(CollabError::InvalidPath(format!(
                    "{target} is already tracked"
                )));
            }
            targets.push((target, *id));
        }
        for (rel, _) in &moving {
            self.by_path.remove(rel);
        }
        for (target, id) in targets {
            self.by_id.insert(id, target.clone());
            self.by_path.insert(target, id);
        }
        Ok(())
    }

    pub fn remove(&mut self, rel: &str) -> Option<FileId> {
        let rel = normalise(rel).ok()?;
        let id = self.by_path.remove(&rel)?;
        self.by_id.remove(&id);
        Some(id)
    }

    pub fn reconcile(&mut self, present: &[String]) -> ReconcileReport {
        let present: BTreeSet<String> = present
            .iter()
            .filter_map(|rel| normalise(rel).ok())
            .collect();
        let removed: Vec<String> = self
            .by_path
            .keys()
            .filter(|rel| !present.contains(*rel))
            .cloned()
            .collect();
        for rel in &removed {
            if let Some(id) = self.by_path.remove(rel) {
                self.by_id.remove(&id);
            }
        }
        let mut added = Vec::new();
        for rel in present {
            if let Entry::Vacant(slot) = self.by_path.entry(rel.clone()) {
                let id = FileId::new_v7();
                slot.insert(id);
                self.by_id.insert(id, rel.clone());
                added.push(rel);
            }
        }
        ReconcileReport { added, removed }
    }

    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }
}

fn normalise(rel: &str) -> Result<String, CollabError> {
    let unified = rel.replace('\\', "/");
    let valid = !unified.is_empty()
        && !unified.starts_with('/')
        && !unified.contains('\0')
        && unified
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..");
    if valid {
        Ok(unified)
    } else {
        Err(CollabError::InvalidPath(format!(
            "not a project-relative path: {rel:?}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn ensure_assigns_one_stable_id_per_normalised_path() {
        let mut map = FileIdMap::default();
        let id = map.ensure("chapters/intro.tex").unwrap();
        assert_eq!(map.ensure("chapters\\intro.tex").unwrap(), id);
        assert_eq!(map.id_of("chapters/intro.tex"), Some(id));
        assert_eq!(map.id_of("chapters\\intro.tex"), Some(id));
        assert_eq!(map.path_of(id), Some("chapters/intro.tex"));
        let other = map.ensure("main.tex").unwrap();
        assert_ne!(other, id);
        assert_eq!(map.len(), 2);
        assert!(!map.is_empty());
        assert!(FileIdMap::default().is_empty());
    }

    #[test]
    fn paths_that_leave_the_project_are_refused() {
        let mut map = FileIdMap::default();
        for rel in [
            "",
            "/etc/passwd",
            "\\\\server\\share\\x.tex",
            "../outside.tex",
            "a/../../b",
            "./main.tex",
            "a//b",
            "figs/",
            "a\0b",
        ] {
            assert!(
                matches!(map.ensure(rel), Err(CollabError::InvalidPath(_))),
                "{rel:?}"
            );
            assert_eq!(map.id_of(rel), None, "{rel:?}");
        }
        assert!(map.is_empty());
    }

    #[test]
    fn rename_moves_the_id_to_the_new_path() {
        let mut map = FileIdMap::default();
        let id = map.ensure("old.tex").unwrap();
        let kept = map.ensure("kept.tex").unwrap();
        map.rename("old.tex", "chapters\\new.tex").unwrap();
        assert_eq!(map.id_of("old.tex"), None);
        assert_eq!(map.id_of("chapters/new.tex"), Some(id));
        assert_eq!(map.path_of(id), Some("chapters/new.tex"));
        assert!(matches!(
            map.rename("missing.tex", "x.tex"),
            Err(CollabError::InvalidPath(_))
        ));
        assert!(matches!(
            map.rename("chapters/new.tex", "kept.tex"),
            Err(CollabError::InvalidPath(_))
        ));
        assert_eq!(map.id_of("kept.tex"), Some(kept));
        map.rename("kept.tex", "kept.tex").unwrap();
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn rename_dir_moves_every_file_under_the_prefix_and_nothing_else() {
        let mut map = FileIdMap::default();
        let a = map.ensure("figs/a.png").unwrap();
        let b = map.ensure("figs/sub/b.png").unwrap();
        let sibling = map.ensure("figs2/c.png").unwrap();
        let named = map.ensure("figs.tex").unwrap();
        map.rename_dir("figs", "images").unwrap();
        assert_eq!(map.path_of(a), Some("images/a.png"));
        assert_eq!(map.path_of(b), Some("images/sub/b.png"));
        assert_eq!(map.path_of(sibling), Some("figs2/c.png"));
        assert_eq!(map.path_of(named), Some("figs.tex"));
        assert_eq!(map.id_of("figs/a.png"), None);
        assert_eq!(map.len(), 4);
    }

    #[test]
    fn rename_dir_changes_nothing_when_it_would_collide_or_nest_into_itself() {
        let mut map = FileIdMap::default();
        map.ensure("figs/a.png").unwrap();
        map.ensure("images/a.png").unwrap();
        let before = map.clone();
        assert!(matches!(
            map.rename_dir("figs", "images"),
            Err(CollabError::InvalidPath(_))
        ));
        assert!(matches!(
            map.rename_dir("figs", "figs/old"),
            Err(CollabError::InvalidPath(_))
        ));
        assert_eq!(map, before);
    }

    #[test]
    fn rename_dir_can_lift_a_folder_into_its_parent() {
        let mut map = FileIdMap::default();
        let nested = map.ensure("a/b/b/x.tex").unwrap();
        let direct = map.ensure("a/b/x.tex").unwrap();
        map.rename_dir("a/b", "a").unwrap();
        assert_eq!(map.path_of(nested), Some("a/b/x.tex"));
        assert_eq!(map.path_of(direct), Some("a/x.tex"));
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn remove_forgets_the_path_and_its_id() {
        let mut map = FileIdMap::default();
        let id = map.ensure("main.tex").unwrap();
        assert_eq!(map.remove("main.tex"), Some(id));
        assert_eq!(map.remove("main.tex"), None);
        assert_eq!(map.path_of(id), None);
        assert!(map.is_empty());
    }

    #[test]
    fn reconcile_adds_new_files_drops_missing_ones_and_keeps_existing_ids() {
        let mut map = FileIdMap::default();
        let kept = map.ensure("main.tex").unwrap();
        map.ensure("gone.tex").unwrap();
        let report = map.reconcile(&strings(&["main.tex", "figs\\a.png", "new.bib", "../bad"]));
        assert_eq!(
            report,
            ReconcileReport {
                added: strings(&["figs/a.png", "new.bib"]),
                removed: strings(&["gone.tex"]),
            }
        );
        assert_eq!(map.id_of("main.tex"), Some(kept));
        assert_eq!(map.len(), 3);
        assert_eq!(
            map.reconcile(&strings(&["main.tex", "figs/a.png", "new.bib"])),
            ReconcileReport::default()
        );
    }

    #[test]
    fn the_map_survives_a_save_and_load() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("paper").join("file-ids.json");
        let mut map = FileIdMap::default();
        let id = map.ensure("chapters/intro.tex").unwrap();
        map.ensure("main.tex").unwrap();
        map.save(&path).unwrap();
        assert_eq!(FileIdMap::load(&path).unwrap(), map);
        let stored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(stored["version"], 1);
        assert_eq!(stored["files"]["chapters/intro.tex"], id.to_string());
    }

    #[test]
    fn a_missing_file_loads_as_an_empty_map() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            FileIdMap::load(&directory.path().join("file-ids.json")),
            Ok(FileIdMap::default())
        );
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn damaged_files_are_reported_as_corrupt() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("file-ids.json");
        let id = "01920000-0000-7000-8000-000000000001";
        for content in [
            "not json".to_string(),
            r#"{"version":2,"files":{}}"#.to_string(),
            format!(r#"{{"version":1,"files":{{"a.tex":"{id}","b.tex":"{id}"}}}}"#),
            format!(r#"{{"version":1,"files":{{"../a.tex":"{id}"}}}}"#),
            format!(r#"{{"version":1,"files":{{"dir\\a.tex":"{id}"}}}}"#),
            r#"{"version":1,"files":{"a.tex":"A07B6610-5950-4B90-8A29-C9EA207236C8"}}"#.to_string(),
        ] {
            std::fs::write(&path, &content).unwrap();
            assert!(
                matches!(FileIdMap::load(&path), Err(CollabError::Corrupt(_))),
                "{content}"
            );
        }
    }
}
