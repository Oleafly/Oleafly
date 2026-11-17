use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use oleafly_collab::doc::NodeKind;
use oleafly_online::realtime::events::EntityId;
use serde::{Deserialize, Serialize};

use super::OverleafLive;
use crate::collab::disk::{safe_target, sha256_hex, stamp_of, write_file_over, WriteOutcome};
use crate::collab::live::downloads::{Bytes, FigureHost};
use crate::collab::live::kept::{KeptFile, KeptKind, KeptPayload};
use crate::collab::live::moves::deleted_here;
use crate::collab::live::session::{guard, io, LiveDisk};
use crate::collab::live::uploads::download_progress_for;
use crate::folder_watch::FolderChange;

const MAP_FILE: &str = "blob-hashes.json";
const UNKNOWN: &str = "server:";
const BIG_DOWNLOAD: u64 = 1024 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct BlobMap {
    #[serde(default)]
    contents: BTreeMap<String, String>,
}

impl BlobMap {
    pub(crate) fn load(dir: &Path) -> BlobMap {
        std::fs::read(dir.join(MAP_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub(super) fn key(&self, hash: Option<&str>, id: &str) -> String {
        hash.and_then(|hash| self.contents.get(hash).cloned())
            .unwrap_or_else(|| format!("{UNKNOWN}{}", hash.unwrap_or(id)))
    }

    pub(super) fn record(&mut self, hash: &str, content: &str) -> bool {
        self.contents.insert(hash.to_owned(), content.to_owned()) != Some(content.to_owned())
    }

    fn save(&self, dir: &Path) {
        let Ok(bytes) = serde_json::to_vec(self) else {
            return;
        };
        if let Err(error) = oleafly_collab::write_atomic(&dir.join(MAP_FILE), &bytes) {
            let _ = crate::project::append_app_log(format!(
                "Live editing could not save the binary file record in {}: {error}",
                dir.display()
            ));
        }
    }
}

fn server_hash(key: &str) -> Option<&str> {
    key.strip_prefix(UNKNOWN)
}

pub(super) fn is_unknown(key: &str) -> bool {
    server_hash(key).is_some()
}

impl super::Mirror {
    pub(super) fn learn_blob(&self, hash: &str, content: &str) {
        let changed = guard(&self.blobs).record(hash, content);
        if changed {
            guard(&self.blobs).save(&self.hold_dir());
            self.mark(std::iter::empty(), true);
        }
    }
}

impl OverleafLive {
    fn entity_of(&self, path: &str, key: &str) -> Option<String> {
        guard(&self.mirror.disk.disk)
            .layout
            .iter()
            .find(|(_, placed)| {
                placed.kind == NodeKind::Blob
                    && placed.path == path
                    && placed.blob.as_deref() == Some(key)
            })
            .map(|(id, _)| id.clone())
    }

    fn keep_both(&self, path: &str, theirs: &[u8]) -> Option<(String, bool)> {
        let disk = &self.mirror.disk;
        let target = safe_target(&disk.root, path)?;
        let stamp = stamp_of(&target);
        let ours = std::fs::read(&target).ok()?;
        let content = sha256_hex(theirs);
        if sha256_hex(&ours) == content {
            guard(&disk.disk).hashes.insert(path.to_owned(), content);
            return None;
        }
        let copy = disk.keep_bytes(path, &ours, None).ok()?;
        let written = match write_file_over(&disk.root, path, theirs, stamp.as_ref()) {
            Ok(WriteOutcome::Written | WriteOutcome::Same) => true,
            Ok(WriteOutcome::ChangedOutside) | Err(_) => false,
        };
        if written {
            guard(&disk.disk).hashes.insert(path.to_owned(), content);
        }
        Some((copy, written))
    }
}

impl FigureHost for OverleafLive {
    fn local(&self) -> &LiveDisk {
        &self.mirror.disk
    }

    fn figure_hold_dir(&self) -> PathBuf {
        self.hold_dir()
    }

    fn fetch_figure(&self, path: &str, hash: &str) -> BoxFuture<'static, Option<Vec<u8>>> {
        let entity = self.entity_of(path, hash);
        let session = Arc::clone(&self.session);
        let report = download_progress_for(
            Arc::clone(&self.mirror.disk.host),
            &self.mirror.disk.project_id,
            path,
        );
        Box::pin(async move {
            let entity = EntityId(entity?);
            let mut shown = false;
            let fetched = session
                .download(&entity, &mut |done, total| {
                    if let Some(total) = total.filter(|total| *total >= BIG_DOWNLOAD) {
                        shown = true;
                        report(done, total);
                    }
                })
                .await;
            if shown {
                report(0, 0);
            }
            fetched.ok()
        })
    }

    fn figure_conflict(self: Arc<Self>, path: String, bytes: Bytes) -> BoxFuture<'static, ()> {
        Box::pin(async move {
            if bytes.is_empty() {
                return;
            }
            let placed = guard(&self.mirror.disk.disk)
                .layout
                .iter()
                .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Blob)
                .map(|(id, placed)| (id.clone(), placed.blob.clone()));
            let Some((id, key)) = placed else {
                return;
            };
            let live = Arc::clone(&self);
            let wanted = path.clone();
            let kept = tauri::async_runtime::spawn_blocking(move || {
                let deleted = deleted_here(
                    &live.mirror.disk.root,
                    &guard(&live.mirror.disk.disk),
                    &wanted,
                );
                if deleted {
                    return None;
                }
                let kept = live.keep_both(&wanted, &bytes)?;
                if kept.1 {
                    if let Some(hash) = key.as_deref().and_then(server_hash) {
                        live.mirror.learn_blob(hash, &sha256_hex(&bytes));
                    }
                }
                Some(kept)
            })
            .await
            .map_err(io);
            let Ok(Some((copy, _))) = kept else {
                return;
            };
            let disk = &self.mirror.disk;
            disk.host.kept(KeptPayload {
                project_id: disk.project_id.clone(),
                files: vec![KeptFile {
                    id,
                    path: path.clone(),
                    copy: copy.clone(),
                    kind: KeptKind::Replaced,
                    by: None,
                }],
            });
            disk.host.folder_changed(FolderChange {
                project_id: disk.project_id.clone(),
                paths: vec![path, copy],
                rescan: false,
                structural: true,
                renamed: Vec::new(),
                deleted: Vec::new(),
            });
            self.mirror.kick();
        })
    }

    fn figure_placed(&self, _path: &str, hash: &str, content: &str) {
        if let Some(hash) = server_hash(hash) {
            self.mirror.learn_blob(hash, content);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_server_file_gets_a_key_no_disk_hash_matches_until_learned() {
        let mut map = BlobMap::default();
        assert_eq!(map.key(Some("abc"), "id1"), "server:abc");
        assert_eq!(map.key(None, "id1"), "server:id1");
        assert_eq!(server_hash("server:abc"), Some("abc"));
        assert!(map.record("abc", "c0ffee"));
        assert!(!map.record("abc", "c0ffee"));
        assert_eq!(map.key(Some("abc"), "id1"), "c0ffee");
        assert_eq!(server_hash("c0ffee"), None);
        let dir = tempfile::tempdir().unwrap();
        map.save(dir.path());
        assert_eq!(BlobMap::load(dir.path()), map);
        assert_eq!(
            BlobMap::load(&dir.path().join("missing")),
            BlobMap::default()
        );
    }
}
