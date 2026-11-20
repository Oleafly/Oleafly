use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use oleafly_collab::doc::FileNode;
use oleafly_collab::live::{DiskWork, LiveProject};
use oleafly_collab::materialize::Layout;
use oleafly_collab::CollabError;

use super::import::{import_renaming, LocalImport};
use super::kept::{self, KeptFile};
use super::session::{guard, lock, Active};
use super::sync_hold::{self, KeptEdit};
use super::{moves, uploads, LiveDisk};

pub(super) struct Outgoing {
    pub(super) work: DiskWork,
    pub(super) next: Layout,
    pub(super) texts: Vec<(String, String)>,
    pub(super) crlf: BTreeSet<String>,
    pub(super) kept: Vec<KeptFile>,
    pub(super) copied: bool,
}

pub(super) struct TreeRequest<'a> {
    pub(super) import: LocalImport,
    pub(super) edits: Vec<KeptEdit>,
    pub(super) hold_dir: &'a Path,
}

pub(super) enum TreeAnswer {
    Applied,
}

pub(super) trait TreeRead {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError>;
    fn text(&self, id: &str) -> Result<Option<String>, CollabError>;
    fn crlf(&self, id: &str) -> bool;
}

pub(super) trait LiveTree: TreeRead + Send + Sync {
    fn read_out(
        &self,
        previous: &mut Layout,
        hashes: &BTreeMap<String, String>,
    ) -> Result<Option<Outgoing>, CollabError>;
    fn can_edit(&self) -> bool;
    fn refused(&self, _import: &LocalImport) {}
    fn open(&self, ids: &[String]) -> BTreeSet<String>;
    fn mark_dirty(&self, ids: &[String]);
    fn noticed(&self, previous: &Layout, changed: &BTreeSet<String>, removed: &[String]);
    fn upload<'a>(
        &'a self,
        root: &'a Path,
        blobs: &'a [(String, String, u64)],
    ) -> BoxFuture<'a, BTreeSet<String>>;
    fn request_tree(
        &self,
        disk: &LiveDisk,
        change: TreeRequest<'_>,
    ) -> Result<TreeAnswer, CollabError>;
}

impl TreeRead for LiveProject {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        self.doc().nodes()
    }

    fn text(&self, id: &str) -> Result<Option<String>, CollabError> {
        self.doc().text(id).map(Some)
    }

    fn crlf(&self, id: &str) -> bool {
        self.doc().crlf(id)
    }
}

impl TreeRead for Active {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        lock(&self.live).doc().nodes()
    }

    fn text(&self, id: &str) -> Result<Option<String>, CollabError> {
        lock(&self.live).doc().text(id).map(Some)
    }

    fn crlf(&self, id: &str) -> bool {
        lock(&self.live).doc().crlf(id)
    }
}

impl LiveTree for Active {
    fn read_out(
        &self,
        previous: &mut Layout,
        hashes: &BTreeMap<String, String>,
    ) -> Result<Option<Outgoing>, CollabError> {
        lock(&self.live).guarded(|live| {
            let work = live.take_disk_work();
            if work.is_empty() {
                return Ok(None);
            }
            let lost = if work.tree {
                kept::keep_lost_figures(live, previous, hashes)?
            } else {
                Vec::new()
            };
            let copied = !lost.is_empty();
            let drawn = LiveDisk::draw(&*live, &work, previous)?;
            let kept = if work.tree {
                kept::notices(live, &drawn.nodes, previous, &drawn.next, lost)
            } else {
                Vec::new()
            };
            Ok(Some(Outgoing {
                work,
                next: drawn.next,
                texts: drawn.texts,
                crlf: drawn.crlf,
                kept,
                copied,
            }))
        })
    }

    fn can_edit(&self) -> bool {
        lock(&self.live).can_edit()
    }

    fn open(&self, ids: &[String]) -> BTreeSet<String> {
        let live = lock(&self.live);
        ids.iter().filter(|id| live.is_open(id)).cloned().collect()
    }

    fn mark_dirty(&self, ids: &[String]) {
        let mut live = lock(&self.live);
        for id in ids {
            live.mark_dirty(id);
        }
    }

    fn noticed(&self, previous: &Layout, changed: &BTreeSet<String>, removed: &[String]) {
        self.announce_removed(previous, removed);
        self.note_arrivals(previous, changed);
    }

    fn upload<'a>(
        &'a self,
        root: &'a Path,
        blobs: &'a [(String, String, u64)],
    ) -> BoxFuture<'a, BTreeSet<String>> {
        Box::pin(async move {
            let progress = |path: &str| {
                uploads::progress_for(Arc::clone(&self.local.host), &self.local.project_id, path)
            };
            let failed = uploads::send(&self.link, root, blobs, self.online(), &progress).await;
            self.announce_uploads();
            failed
        })
    }

    fn request_tree(
        &self,
        disk: &LiveDisk,
        change: TreeRequest<'_>,
    ) -> Result<TreeAnswer, CollabError> {
        let TreeRequest {
            mut import,
            edits,
            hold_dir,
        } = change;
        let (changed, renamed) = {
            let mut state = guard(&disk.disk);
            let mut live = lock(&self.live);
            let mut bases = guard(&disk.bases);
            moves::adopt_folder_moves(&mut live, &mut state, &mut bases, &mut import)?;
            let (imported, renamed) =
                import_renaming(&mut live, &mut state, &mut bases, import, &disk.root)?;
            let kept = sync_hold::apply_kept_edits(
                hold_dir, &disk.root, &mut live, &mut state, &mut bases, edits,
            )?;
            (imported || kept, renamed)
        };
        self.announce_new_names(renamed);
        if changed {
            self.handle.flush();
            self.kick();
            self.refresh_pending();
        }
        Ok(TreeAnswer::Applied)
    }
}
