use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Weak};
use std::time::Duration;

use oleafly_collab::doc::{FileNode, NodeKind};
use oleafly_collab::live::DiskWork;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;

use super::disk_pass::{apply_to_disk, DiskPass, DiskTexts, LeftAlone};
use super::import::{name_of, parent_of, placed_now, scan_local, LocalImport};
use super::live_tree::{LiveTree, Outgoing, TreeAnswer, TreeRead, TreeRequest};
use super::payloads::{FolderChange, KeptPayload};
use super::session::{guard, io, WriterSignal};
use super::sync_hold;
use super::unwritten::Settled;
use super::LiveDisk;
use crate::disk::{inside, safe_target, sha256_hex, DiskState};
use oleafly_core::front_matter::NOTE_FILE;
use tokio::sync::mpsc::UnboundedReceiver;

const SHORT_HASH: usize = 6;
const WRITE_DEBOUNCE: Duration = Duration::from_millis(120);

fn tagged(name: &str, tag: &str) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({tag}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({tag})"),
    }
}

pub struct Drawn {
    pub nodes: Vec<FileNode>,
    pub next: Layout,
    pub texts: Vec<(String, String)>,
    pub crlf: BTreeSet<String>,
}

pub trait LiveWriter: Send + Sync + 'static {
    fn disk(&self) -> &LiveDisk;
    fn write_pass(
        self: Arc<Self>,
        urgent: bool,
    ) -> impl Future<Output = Result<Vec<String>, CollabError>> + Send;
    fn import_pass(
        self: Arc<Self>,
        only: Vec<String>,
    ) -> impl Future<Output = Result<(), CollabError>> + Send;
}

pub async fn writer_loop<W: LiveWriter>(
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
        match Arc::clone(&owner).write_pass(!waiters.is_empty()).await {
            Ok(reread) if !reread.is_empty() => {
                if let Err(error) = Arc::clone(&owner).import_pass(reread).await {
                    owner.disk().log_once("reread", || {
                        format!("could not send files changed while they were written: {error}")
                    });
                }
            }
            Ok(_) => {}
            Err(error) => owner.disk().log_once("write", || {
                format!("could not write the shared files to disk: {error}")
            }),
        }
        for done in waiters {
            let _ = done.send(());
        }
    }
}

pub(super) fn publish(shared: &mut DiskState, before: &DiskState, after: DiskState) {
    let DiskState { layout, hashes, .. } = after;
    for path in before
        .hashes
        .keys()
        .filter(|path| !hashes.contains_key(*path))
    {
        shared.hashes.remove(path);
    }
    for (path, hash) in hashes {
        let known = before.hashes.get(&path);
        if known != Some(&hash) && shared.hashes.get(&path) == known {
            shared.hashes.insert(path, hash);
        }
    }
    for id in before.layout.keys().filter(|id| !layout.contains_key(*id)) {
        shared.layout.remove(id);
    }
    for (id, placed) in layout {
        if before.layout.get(&id) != Some(&placed) {
            shared.layout.insert(id, placed);
        }
    }
}

pub struct Mirrored {
    pub conflicts: Vec<String>,
    pub blobs: Vec<(String, String)>,
}

impl LiveDisk {
    pub fn copy_name(
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

    pub fn keep_copy(
        &self,
        path: &str,
        text: &str,
        author: Option<&str>,
    ) -> Result<String, CollabError> {
        self.keep_bytes(path, text.as_bytes(), author)
    }

    pub fn keep_bytes(
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
        let beside = |named: &str| {
            parent.map_or_else(|| named.to_owned(), |parent| format!("{parent}/{named}"))
        };
        let kept_before = |named: &str| {
            safe_target(&self.root, &beside(named))
                .and_then(|target| std::fs::read(target).ok())
                .is_some_and(|kept| sha256_hex(&kept) == hash)
        };
        let named = author
            .and_then(|author| materialize::credited_name(name, author, &hash, free))
            .or_else(|| {
                [SHORT_HASH, 12, hash.len()]
                    .into_iter()
                    .map(|length| tagged(name, &hash[..length]))
                    .find(|named| free(named) || kept_before(named))
            })
            .ok_or_else(|| CollabError::Io(format!("no free name to keep a copy of {path}")))?;
        let copy = beside(&named);
        let target = safe_target(&self.root, &copy)
            .ok_or_else(|| CollabError::Io(format!("no place to keep a copy of {path}")))?;
        if free(&named) {
            oleafly_core::own_writes::write_own(&target, bytes).map_err(io)?;
        }
        guard(&self.disk).hashes.insert(copy.clone(), hash);
        Ok(copy)
    }

    pub fn draw(
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

    pub fn snapshot(&self) -> (Layout, BTreeMap<String, String>, Vec<String>) {
        let disk = guard(&self.disk);
        (disk.layout.clone(), disk.hashes.clone(), disk.owed_paths())
    }

    pub fn mirror(
        &self,
        tree: &dyn LiveTree,
        hold_dir: &Path,
        previous: &Layout,
        owed: &[String],
        mirror: Outgoing,
        urgent: bool,
    ) -> Result<Mirrored, CollabError> {
        let Outgoing {
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
            let before = guard(&self.disk).clone();
            let mut after = before.clone();
            let left = LeftAlone {
                blocked: &blocked,
                pinned: &pinned,
            };
            let pass = apply_to_disk(
                &self.root,
                &mut after,
                &mut &self.bases,
                plan,
                next,
                &DiskTexts {
                    texts: &texts,
                    crlf: &crlf,
                },
                &left,
            );
            publish(&mut guard(&self.disk), &before, after);
            pass?
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
        if written.contains(NOTE_FILE) {
            if let Some((_, text)) = texts.iter().find(|(path, _)| path == NOTE_FILE) {
                self.host.note_written(&self.project_id, text);
            }
        }
        let saved = guard(&self.disk).clone();
        tree.save_index(self, &saved);
        let layout = saved.layout;
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

    async fn scan(
        &self,
        tree: &dyn LiveTree,
        only: Option<Vec<String>>,
    ) -> Result<(LocalImport, DiskState), CollabError> {
        let snapshot = guard(&self.disk).clone();
        let placed = placed_now(tree)?;
        let root = self.root.clone();
        let (scanned, snapshot) = self
            .runtime
            .spawn_blocking(move || {
                let scanned = scan_local(&root, &snapshot, &placed, only.as_deref());
                (scanned, snapshot)
            })
            .await
            .map_err(io)?;
        let import = scanned?.classify(tree);
        if let Some((path, error)) = import.unread.first() {
            self.log_once("unread", || {
                format!("could not read {path}, so its changes wait: {error}")
            });
        }
        Ok((import, snapshot))
    }

    pub async fn changed(&self, tree: &dyn LiveTree) -> Result<Vec<String>, CollabError> {
        let (import, snapshot) = self.scan(tree, None).await?;
        let texts = import.texts.iter().map(|(path, _, hash)| (path, hash));
        let blobs = import.blobs.iter().map(|(path, hash, _)| (path, hash));
        Ok(texts
            .chain(blobs)
            .filter(|(path, hash)| snapshot.hashes.get(*path) != Some(hash))
            .map(|(path, _)| path.clone())
            .collect())
    }

    pub async fn import(
        &self,
        tree: &dyn LiveTree,
        hold_dir: &Path,
        only: Option<Vec<String>>,
    ) -> Result<(), CollabError> {
        if !self.root.is_dir() || !tree.ready_to_import() {
            return Ok(());
        }
        let (mut import, snapshot) = self.scan(tree, only).await?;
        if !tree.ready_to_import() {
            return Ok(());
        }
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
                seen: &snapshot.hashes,
            },
        )?;
        Ok(())
    }
}
