use std::path::Path;
use std::sync::Arc;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::materialize;
use oleafly_collab::CollabError;

use super::session::{active_for, guard, lock, not_live, Active};
use super::sync_hold::SyncDecision;
use crate::collab::disk::{as_text, safe_target, sha256_hex, DiskState};
use crate::folder_watch::FolderChange;

pub(crate) struct KnownContent {
    active: Option<Arc<Active>>,
    hashes: std::collections::BTreeMap<String, String>,
}

fn saved_disk(project_id: &str) -> DiskState {
    crate::paths::collab_root()
        .ok()
        .and_then(|root| {
            oleafly_collab::CollabPaths::new(root)
                .materializer_index_file(project_id)
                .ok()
        })
        .map(|file| DiskState::load(&file))
        .unwrap_or_default()
}

pub(crate) fn known_content(project_id: &str) -> KnownContent {
    if let Some(active) = active_for(project_id) {
        let hashes = guard(&active.disk).hashes.clone();
        return KnownContent {
            active: Some(active),
            hashes,
        };
    }
    KnownContent {
        active: None,
        hashes: saved_disk(project_id).hashes,
    }
}

pub(crate) fn shared_files(project_id: &str) -> std::collections::BTreeSet<String> {
    let files = |disk: &DiskState| {
        disk.hashes
            .keys()
            .cloned()
            .chain(
                disk.layout
                    .values()
                    .filter(|placed| placed.kind != NodeKind::Dir)
                    .map(|placed| placed.path.clone()),
            )
            .collect()
    };
    match active_for(project_id) {
        Some(active) => files(&guard(&active.disk)),
        None => files(&saved_disk(project_id)),
    }
}

impl KnownContent {
    pub(crate) fn holds(&self, root: &Path, path: &str) -> bool {
        let Some(bytes) = safe_target(root, path).and_then(|target| std::fs::read(target).ok())
        else {
            return false;
        };
        if self
            .hashes
            .get(path)
            .is_some_and(|known| *known == sha256_hex(&bytes))
        {
            return true;
        }
        let (Some(active), Some(text)) = (&self.active, as_text(&bytes)) else {
            return false;
        };
        let live = lock(&active.live);
        let Ok(nodes) = live.doc().nodes() else {
            return false;
        };
        materialize::layout(&nodes)
            .iter()
            .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
            .and_then(|(id, _)| live.doc().text(id).ok())
            .is_some_and(|shared| shared == text)
    }
}

pub fn app_wrote(project_id: &str, path: &str) {
    if let Some(active) = active_for(project_id) {
        let paths = vec![path.to_owned()];
        tauri::async_runtime::spawn(async move {
            let _ = active.import_paths(Some(paths)).await;
        });
    }
}

pub async fn resume(project_id: &str, decision: SyncDecision) -> Result<(), CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    active.decide(decision).await
}

pub fn folder_changed(change: &FolderChange) {
    if let Some(active) = active_for(&change.project_id) {
        let only = (!change.rescan).then(|| change.paths.clone());
        tauri::async_runtime::spawn(async move {
            let _ = active.import_paths(only).await;
        });
    }
}
