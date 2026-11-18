use std::path::Path;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::materialize;
use oleafly_collab::CollabError;

use super::session::{guard, live_for, lock, not_live, Live};
use super::sync_hold::SyncDecision;
use crate::collab::disk::{as_text, safe_target, sha256_hex, DiskState};
use crate::folder_watch::FolderChange;

pub(crate) struct KnownContent {
    live: Option<Live>,
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
    if let Some(live) = live_for(project_id) {
        let hashes = match &live {
            Live::Server(active) => guard(&active.local.disk).hashes.clone(),
            Live::Overleaf(live) => live.with_disk(|disk| disk.hashes.clone()),
        };
        return KnownContent {
            live: Some(live),
            hashes,
        };
    }
    KnownContent {
        live: None,
        hashes: saved_disk(project_id).hashes,
    }
}

pub(crate) fn shared_files(project_id: &str) -> std::collections::BTreeSet<String> {
    let files = |disk: &DiskState| {
        let owed: Vec<String> = disk
            .owed
            .values()
            .filter_map(|id| disk.layout.get(id).map(|placed| placed.path.clone()))
            .collect();
        disk.hashes
            .keys()
            .cloned()
            .chain(
                disk.layout
                    .values()
                    .filter(|placed| placed.kind != NodeKind::Dir)
                    .filter(|placed| {
                        !owed
                            .iter()
                            .any(|to| crate::collab::disk::inside(&placed.path, to))
                    })
                    .map(|placed| placed.path.clone()),
            )
            .collect()
    };
    match live_for(project_id) {
        Some(Live::Server(active)) => files(&guard(&active.local.disk)),
        Some(Live::Overleaf(live)) => live.with_disk(files),
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
        let (Some(live), Some(text)) = (&self.live, as_text(&bytes)) else {
            return false;
        };
        let active = match live {
            Live::Server(active) => active,
            Live::Overleaf(live) => return live.text_at(path).is_some_and(|shared| shared == text),
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
    let paths = vec![path.to_owned()];
    match live_for(project_id) {
        Some(Live::Server(active)) => {
            tauri::async_runtime::spawn(async move {
                let _ = active.import_paths(Some(paths)).await;
            });
        }
        Some(Live::Overleaf(live)) => {
            tauri::async_runtime::spawn(async move {
                let _ = live.import_paths(Some(paths)).await;
            });
        }
        None => {}
    }
}

pub async fn resume(project_id: &str, decision: SyncDecision) -> Result<(), CollabError> {
    match live_for(project_id).ok_or_else(not_live)? {
        Live::Server(active) => active.decide(decision).await,
        Live::Overleaf(_) => Err(not_live()),
    }
}

pub fn folder_changed(change: &FolderChange) {
    let only = (!change.rescan).then(|| change.paths.clone());
    match live_for(&change.project_id) {
        Some(Live::Server(active)) => {
            tauri::async_runtime::spawn(async move {
                let _ = active.import_paths(only).await;
            });
        }
        Some(Live::Overleaf(live)) => {
            tauri::async_runtime::spawn(async move {
                let _ = live.import_paths(only).await;
            });
        }
        None => {}
    }
}
