use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Weak};
use std::time::Duration;

use oleafly_collab::doc::{FileNode, NodeKind};
use oleafly_collab::live::DiskWork;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;

use super::disk_pass::{apply_to_disk, DiskPass, LeftAlone};
use super::import::{name_of, parent_of, placed_now, scan_local};
use super::kept::KeptPayload;
use super::live_tree::{LiveTree, Mirror, TreeAnswer, TreeRead, TreeRequest};
use super::session::{guard, io, WriterSignal};
use super::sync_hold;
use super::unwritten::Settled;
use super::LiveDisk;
use crate::collab::disk::{inside, safe_target, sha256_hex};
use crate::folder_watch::FolderChange;
use tokio::sync::mpsc::UnboundedReceiver;

const SHORT_HASH: usize = 6;
const WRITE_DEBOUNCE: Duration = Duration::from_millis(120);

fn tagged(name: &str, tag: &str) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({tag}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({tag})"),
    }
}

pub(super) struct Drawn {
    pub(super) nodes: Vec<FileNode>,
    pub(super) next: Layout,
    pub(super) texts: Vec<(String, String)>,
    pub(super) crlf: BTreeSet<String>,
}

pub(super) trait LiveWriter: Send + Sync + 'static {
    fn write_pass(
        self: Arc<Self>,
        urgent: bool,
    ) -> impl Future<Output = Result<Vec<String>, CollabError>> + Send;
    fn import_pass(
        self: Arc<Self>,
        only: Vec<String>,
    ) -> impl Future<Output = Result<(), CollabError>> + Send;
}

pub(super) async fn writer_loop<W: LiveWriter>(
    owner: Weak<W>,
    mut signals: UnboundedReceiver<WriterSignal>,
) {
    while let Some(first) = signals.recv().await {
        let mut waiters = Vec::new();
        if let WriterSignal::Flush(done) = first {
            waiters.push(done);
        } else {
            tokio::time::sleep(WRITE_DEBOUNCE).await;
        }
        while let Ok(more) = signals.try_recv() {
            if let WriterSignal::Flush(done) = more {
                waiters.push(done);
            }
        }
        let Some(owner) = owner.upgrade() else {
            return;
        };
        if let Ok(reread) = Arc::clone(&owner).write_pass(!waiters.is_empty()).await {
            if !reread.is_empty() {
                let _ = owner.import_pass(reread).await;
            }
        }
        for done in waiters {
            let _ = done.send(());
        }
    }
}

pub(super) struct Mirrored {
    pub(super) conflicts: Vec<String>,
    pub(super) blobs: Vec<(String, String)>,
}

impl LiveDisk {
    pub(super) fn copy_name(
        name: &str,
        author: Option<&str>,
        hash: &str,
        taken: &mut BTreeSet<String>,
    ) -> String {
        let credited = author.and_then(|author| {
            materialize::credited_name(name, author, hash, |named| {
                taken.insert(named.to_lowercase())
            })
        });
        credited.unwrap_or_else(|| {
            let named = tagged(name, &hash[..hash.len().min(SHORT_HASH)]);
            taken.insert(named.to_lowercase());
            named
        })
    }

    pub(super) fn keep_copy(
        &self,
        path: &str,
        text: &str,
        author: Option<&str>,
    ) -> Result<String, CollabError> {
        self.keep_bytes(path, text.as_bytes(), author)
    }

    pub(super) fn keep_bytes(
        &self,
        path: &str,
        bytes: &[u8],
        author: Option<&str>,
    ) -> Result<String, CollabError> {
        let parent = parent_of(path);
        let folder = parent.map_or_else(|| self.root.clone(), |parent| self.root.join(parent));
        let taken: BTreeSet<String> = std::fs::read_dir(&folder)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.file_name().to_string_lossy().to_lowercase())
                    .collect()
            })
            .unwrap_or_default();
        let free = |named: &str| !taken.contains(&named.to_lowercase());
        let name = name_of(path);
        let hash = sha256_hex(bytes);
        let named = author
            .and_then(|author| materialize::credited_name(name, author, &hash, free))
            .or_else(|| {
                [SHORT_HASH, 12, hash.len()]
                    .into_iter()
                    .map(|length| tagged(name, &hash[..length]))
                    .find(|named| free(named))
            })
            .ok_or_else(|| CollabError::Io(format!("no free name to keep a copy of {path}")))?;
        let copy = parent.map_or_else(|| named.clone(), |parent| format!("{parent}/{named}"));
        let target = safe_target(&self.root, &copy)
            .ok_or_else(|| CollabError::Io(format!("no place to keep a copy of {path}")))?;
        oleafly_collab::write_atomic(&target, bytes)?;
        Ok(copy)
    }

    pub(super) fn draw(
        read: &(impl TreeRead + ?Sized),
        work: &DiskWork,
        previous: &Layout,
    ) -> Result<Drawn, CollabError> {
        let nodes = read.nodes()?;
        let next = materialize::layout(&nodes);
        let mut ids: BTreeSet<String> = work.texts.clone();
        for (id, placed) in &next {
            let moved_or_new = previous
                .get(id)
                .is_none_or(|before| before.path != placed.path);
            if placed.kind == NodeKind::Text && moved_or_new {
                ids.insert(id.clone());
            }
        }
        let mut texts = Vec::new();
        let mut crlf = BTreeSet::new();
        for id in ids {
            let Some(placed) = next.get(&id).filter(|placed| placed.kind == NodeKind::Text) else {
                continue;
            };
            let Some(text) = read.text(&id)? else {
                continue;
            };
            texts.push((placed.path.clone(), text));
            if read.crlf(&id) {
                crlf.insert(placed.path.clone());
            }
        }
        Ok(Drawn {
            nodes,
            next,
            texts,
            crlf,
        })
    }

    pub(super) fn snapshot(&self) -> (Layout, BTreeMap<String, String>, Vec<String>) {
        let disk = guard(&self.disk);
        (disk.layout.clone(), disk.hashes.clone(), disk.owed_paths())
    }

    pub(super) fn mirror(
        &self,
        tree: &dyn LiveTree,
        hold_dir: &Path,
        previous: &Layout,
        owed: &[String],
        mirror: Mirror,
        urgent: bool,
    ) -> Result<Mirrored, CollabError> {
        let Mirror {
            work,
            next,
            mut texts,
            crlf,
            kept,
            ..
        } = mirror;
        let mut plan = materialize::plan(previous, &next);
        if !urgent {
            self.hold_back_typing(tree, &next, &mut texts);
        }
        let still_held = self.hold_back_failing(tree, &next, &mut texts, urgent);
        if !owed.is_empty() {
            self.hold_back_owed(tree, &next, &mut texts, owed);
        }
        let shaped = sync_hold::shape(hold_dir, &self.root, &mut plan, &mut texts, &next);
        let structural = !plan.moved.is_empty()
            || !plan.removed.is_empty()
            || !plan.dirs.is_empty()
            || work.tree;
        let owed_here = |path: &str| {
            owed.iter()
                .any(|held| inside(path, held) || inside(held, path))
        };
        let blocked = |path: &str| shaped.blocks(path) || owed_here(path);
        let pinned = |path: &str| shaped.pins(path) || owed_here(path);
        let DiskPass {
            mut changed,
            mut conflicts,
            blobs,
            moved,
            removed,
            written,
            done,
            mut failed,
            waiting,
        } = {
            let mut disk = guard(&self.disk);
            let mut bases = guard(&self.bases);
            let left = LeftAlone {
                blocked: &blocked,
                pinned: &pinned,
            };
            apply_to_disk(
                &self.root, &mut disk, &mut bases, plan, next, &texts, &crlf, &left,
            )?
        };
        if !waiting.is_empty() {
            tree.mark_dirty(&waiting);
        }
        failed.extend(still_held);
        conflicts.extend(shaped.conflicts.iter().cloned());
        sync_hold::settle(hold_dir, shaped, &conflicts);
        if !kept.is_empty() {
            self.host.kept(KeptPayload {
                project_id: self.project_id.clone(),
                files: kept,
            });
        }
        tree.noticed(previous, &changed, &removed);
        self.note_written(&written);
        if written.contains(crate::project::NOTE_FILE) {
            if let Some((_, text)) = texts
                .iter()
                .find(|(path, _)| path == crate::project::NOTE_FILE)
            {
                crate::note_index::note_file_written(&self.project_id, text.as_bytes());
            }
        }
        let layout = {
            let disk = guard(&self.disk);
            self.save_index_if_changed(&disk);
            disk.layout.clone()
        };
        self.settle_unwritten(
            tree,
            &layout,
            Settled {
                done,
                failed,
                conflicts: conflicts.clone(),
            },
        );
        let typed_here = Self::open_texts(tree, &layout, &written, &moved);
        changed.retain(|path| !typed_here.contains(path));
        self.note_unannounced(&typed_here, &changed, &moved, &removed);
        if !changed.is_empty() || structural {
            self.host.folder_changed(FolderChange {
                project_id: self.project_id.clone(),
                paths: changed.into_iter().collect(),
                rescan: false,
                structural,
                renamed: moved,
                deleted: removed,
            });
        }
        Ok(Mirrored { conflicts, blobs })
    }

    fn open_texts(
        tree: &dyn LiveTree,
        layout: &Layout,
        written: &BTreeSet<String>,
        moved: &[(String, String)],
    ) -> BTreeSet<String> {
        let candidates: Vec<(&String, &String)> = layout
            .iter()
            .filter(|(_, placed)| {
                placed.kind == NodeKind::Text
                    && written.contains(&placed.path)
                    && !moved
                        .iter()
                        .any(|(from, to)| *from == placed.path || *to == placed.path)
            })
            .map(|(id, placed)| (id, &placed.path))
            .collect();
        if candidates.is_empty() {
            return BTreeSet::new();
        }
        let ids: Vec<String> = candidates.iter().map(|(id, _)| (*id).clone()).collect();
        let open = tree.open(&ids);
        candidates
            .into_iter()
            .filter(|(id, _)| open.contains(*id))
            .map(|(_, path)| path.clone())
            .collect()
    }

    pub(super) async fn import(
        &self,
        tree: &dyn LiveTree,
        hold_dir: &Path,
        only: Option<Vec<String>>,
    ) -> Result<(), CollabError> {
        if !self.root.is_dir() {
            return Ok(());
        }
        let snapshot = guard(&self.disk).clone();
        let placed = placed_now(tree)?;
        let root = self.root.clone();
        let (scanned, snapshot) = tauri::async_runtime::spawn_blocking(move || {
            let scanned = scan_local(&root, &snapshot, &placed, only.as_deref());
            (scanned, snapshot)
        })
        .await
        .map_err(io)?;
        let mut import = scanned?.classify(tree);
        let edits = sync_hold::screen(hold_dir, &self.root, &snapshot, &mut import)?;
        if import.is_empty() && edits.is_empty() {
            return Ok(());
        }
        if !tree.can_edit() {
            tree.refused(&import);
            return Ok(());
        }
        let failed = tree.upload(&self.root, &import.blobs).await;
        import.blobs.retain(|(_, hash, _)| !failed.contains(hash));
        let TreeAnswer::Applied = tree.request_tree(
            self,
            TreeRequest {
                import,
                edits,
                hold_dir,
            },
        )?;
        Ok(())
    }
}
