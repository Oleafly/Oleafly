use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use oleafly_collab::doc::NodeKind;
use oleafly_online::live::rest::RestError;
use oleafly_online::realtime::events::EntityId;
use serde::{Deserialize, Serialize};

use super::OverleafLive;
use crate::collab::disk::{safe_target, sha256_hex, stamp_of, write_file_over, WriteOutcome};
use crate::collab::live::downloads::{Bytes, FigureHost};
use crate::collab::live::kept::{KeptFile, KeptKind, KeptPayload};
use crate::collab::live::moves::deleted_here;
use crate::collab::live::session::{guard, LiveDisk};
use crate::collab::live::unwritten::{reason_of, UnwrittenReason};
use crate::collab::live::uploads::download_progress_for;
use crate::folder_watch::FolderChange;

const MAP_FILE: &str = "blob-hashes.json";
const UNKNOWN: &str = "server:";
const BIG_DOWNLOAD: u64 = 1024 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct BlobMap {
    #[serde(default)]
    contents: BTreeMap<String, String>,
    #[serde(skip)]
    unsaved: bool,
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
        let changed =
            self.contents.insert(hash.to_owned(), content.to_owned()) != Some(content.to_owned());
        self.unsaved |= changed;
        changed
    }

    fn save(&mut self, dir: &Path) -> bool {
        let written = serde_json::to_vec(self)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                oleafly_collab::write_atomic(&dir.join(MAP_FILE), &bytes)
                    .map_err(|error| error.to_string())
            });
        match &written {
            Ok(()) => self.unsaved = false,
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Live editing could not save the binary file record in {}: {error}",
                    dir.display()
                ));
            }
        }
        written.is_ok()
    }
}

fn download_failure(error: &RestError) -> &'static str {
    match error {
        RestError::TooLarge => "download too large",
        RestError::SignedOut => "download signed out",
        RestError::NotAllowed | RestError::Refused { .. } => "download refused",
        RestError::RateLimited(_) => "download slowed",
        _ => "download",
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
        if guard(&self.blobs).record(hash, content) {
            self.mark(std::iter::empty(), true);
        }
    }

    pub(super) fn save_blobs(&self) {
        let unsaved = {
            let mut blobs = guard(&self.blobs);
            std::mem::take(&mut blobs.unsaved).then(|| blobs.clone())
        };
        if unsaved.is_some_and(|mut blobs| !blobs.save(&self.hold_dir())) {
            guard(&self.blobs).unsaved = true;
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

    fn keep_both(&self, path: &str, theirs: &[u8]) -> Result<Option<(String, bool)>, String> {
        let disk = &self.mirror.disk;
        let Some(target) = safe_target(&disk.root, path) else {
            return Ok(None);
        };
        let stamp = stamp_of(&target);
        let ours = match std::fs::read(&target) {
            Ok(ours) => ours,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let content = sha256_hex(theirs);
        if sha256_hex(&ours) == content {
            guard(&disk.disk).hashes.insert(path.to_owned(), content);
            return Ok(None);
        }
        let copy = disk
            .keep_bytes(path, &ours, None)
            .map_err(|error| error.to_string())?;
        let written = match write_file_over(&disk.root, path, theirs, stamp.as_ref()) {
            Ok(WriteOutcome::Written | WriteOutcome::Same) => true,
            Ok(WriteOutcome::ChangedOutside) => false,
            Err(error) => return Err(error),
        };
        if written {
            guard(&disk.disk).hashes.insert(path.to_owned(), content);
        }
        Ok(Some((copy, written)))
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
        if guard(&self.mirror.too_large).contains(hash) {
            return Box::pin(async { None });
        }
        let session = Arc::clone(&self.session);
        let mirror = Arc::clone(&self.mirror);
        let (wanted, hash) = (path.to_owned(), hash.to_owned());
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
                    if total.unwrap_or(done) >= BIG_DOWNLOAD {
                        shown = true;
                        report(done, total);
                    }
                })
                .await;
            if shown {
                report(0, Some(0));
            }
            let error = match fetched {
                Ok(bytes) => return Some(bytes),
                Err(error) => error,
            };
            if matches!(error, RestError::TooLarge) {
                guard(&mirror.too_large).insert(hash);
            }
            mirror.disk.log_once(download_failure(&error), || {
                format!("could not download {wanted}: {error}")
            });
            None
        })
    }

    fn figure_conflict(
        self: Arc<Self>,
        path: String,
        bytes: Bytes,
    ) -> BoxFuture<'static, Option<UnwrittenReason>> {
        Box::pin(async move {
            if bytes.is_empty() {
                return None;
            }
            let placed = guard(&self.mirror.disk.disk)
                .layout
                .iter()
                .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Blob)
                .map(|(id, placed)| (id.clone(), placed.blob.clone()));
            let (id, key) = placed?;
            let live = Arc::clone(&self);
            let wanted = path.clone();
            let kept = tauri::async_runtime::spawn_blocking(move || {
                let deleted = deleted_here(
                    &live.mirror.disk.root,
                    &guard(&live.mirror.disk.disk),
                    &wanted,
                );
                if deleted {
                    return Ok(None);
                }
                let kept = live.keep_both(&wanted, &bytes)?;
                if kept.as_ref().is_some_and(|(_, written)| *written) {
                    if let Some(hash) = key.as_deref().and_then(server_hash) {
                        live.mirror.learn_blob(hash, &sha256_hex(&bytes));
                    }
                }
                Ok(kept)
            })
            .await
            .map_err(|error| error.to_string())
            .and_then(|kept| kept);
            let disk = &self.mirror.disk;
            let copy = match kept {
                Ok(Some((copy, _))) => copy,
                Ok(None) => return None,
                Err(error) => {
                    disk.log_once("figure copy", || {
                        format!("could not keep the local copy of {path} before writing the shared one: {error}")
                    });
                    return Some(reason_of(&disk.root, &path, &error));
                }
            };
            disk.host.kept(KeptPayload {
                project_id: disk.project_id.clone(),
                files: vec![KeptFile {
                    id,
                    path: path.clone(),
                    copy: Some(copy.clone()),
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
            None
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
