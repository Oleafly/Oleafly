use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use futures_util::future::BoxFuture;
use oleafly_collab::doc::{FileNode, NodeKind, NodeParent};
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::live::tree_queue::{TreeChange, TreeRefusal};
use oleafly_online::realtime::tree::{NodeKind as OverleafKind, OverleafNode};
use oleafly_online::realtime::DocId;

use super::{Edit, OverleafLive, TreeNotice, TreeNoticeKind};
use crate::collab::disk::{safe_target, sha256_hex};
use crate::collab::live::import::{arrival_of, placed_now, LocalImport};
use crate::collab::live::kept::{KeptFile, KeptKind};
use crate::collab::live::live_tree::{
    LiveTree, Mirror as Outgoing, TreeAnswer, TreeRead, TreeRequest,
};
use crate::collab::live::moves::{
    arrived_paths, folder_arrival, outermost_gone_dirs, took_folder_move, RemovedFile,
    RemovedPayload,
};
use crate::collab::live::session::{guard, LiveDisk};

pub(super) fn file_nodes(nodes: &[OverleafNode]) -> Vec<FileNode> {
    let root = nodes
        .iter()
        .find(|node| node.parent.is_none() && node.kind == OverleafKind::Folder)
        .map(|node| node.id.clone());
    nodes
        .iter()
        .filter(|node| Some(&node.id) != root.as_ref())
        .map(|node| FileNode {
            id: node.id.0.clone(),
            parent: match &node.parent {
                Some(parent) if Some(parent) != root.as_ref() => NodeParent::Node(parent.0.clone()),
                _ => NodeParent::Root,
            },
            name: node.name.clone(),
            kind: match node.kind {
                OverleafKind::Doc => NodeKind::Text,
                OverleafKind::File => NodeKind::Blob,
                OverleafKind::Folder => NodeKind::Dir,
            },
            blob: None,
            position: node.name.clone(),
            author_name: None,
        })
        .collect()
}

pub(super) fn doc_at(nodes: &[OverleafNode], path: &str) -> Option<DocId> {
    materialize::layout(&file_nodes(nodes))
        .into_iter()
        .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
        .map(|(id, _)| DocId(id))
}

fn file_name(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

fn inside(path: &str, folder: &str) -> bool {
    path == folder || path.starts_with(&format!("{folder}/"))
}

impl OverleafLive {
    fn tree_change(&self, change: TreeChange) -> bool {
        let path = change.path().to_owned();
        match self.session.change_tree(change) {
            Ok(()) => true,
            Err(TreeRefusal::NotAllowed) => {
                self.refuse(vec![path]);
                false
            }
            Err(_) => false,
        }
    }

    fn refuse(&self, paths: Vec<String>) {
        let fresh: Vec<String> = {
            let mut told = guard(&self.mirror.deletes);
            paths
                .into_iter()
                .filter(|path| told.refused.insert(path.clone()))
                .collect()
        };
        self.tell(TreeNoticeKind::NotAllowed { paths: fresh });
    }

    pub(super) fn tell(&self, kind: TreeNoticeKind) {
        let empty = match &kind {
            TreeNoticeKind::DeleteAsked { paths }
            | TreeNoticeKind::NotAllowed { paths }
            | TreeNoticeKind::KeptAway { paths }
            | TreeNoticeKind::StoredAsFiles { paths } => paths.is_empty(),
        };
        if !empty {
            self.mirror.disk.host.overleaf_tree(TreeNotice {
                project_id: self.mirror.disk.project_id.clone(),
                kind,
            });
        }
    }

    fn ask_to_delete(&self, paths: Vec<String>) {
        let fresh: Vec<String> = {
            let mut deletes = guard(&self.mirror.deletes);
            paths
                .into_iter()
                .filter(|path| {
                    deletes.mine.insert(path.clone());
                    deletes.asked.insert(path.clone())
                })
                .collect()
        };
        self.tell(TreeNoticeKind::DeleteAsked { paths: fresh });
    }

    pub(crate) async fn restore(&self, path: &str) -> Result<(), CollabError> {
        let copy = guard(&self.mirror.restorable)
            .get(path)
            .cloned()
            .ok_or_else(|| CollabError::Io(format!("no kept copy of {path}")))?;
        let root = self.mirror.disk.root.clone();
        let (from, to) = (copy.clone(), path.to_owned());
        tauri::async_runtime::spawn_blocking(move || {
            let source = crate::collab::disk::safe_target(&root, &from);
            let target = crate::collab::disk::safe_target(&root, &to);
            match (source, target) {
                (Some(source), Some(target)) if !target.exists() => std::fs::rename(source, target),
                _ => Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists)),
            }
        })
        .await
        .map_err(crate::collab::live::session::io)?
        .map_err(crate::collab::live::session::io)?;
        guard(&self.mirror.restorable).remove(path);
        self.import_paths(Some(vec![copy, path.to_owned()])).await
    }

    pub(crate) fn decide_deletes(&self, paths: &[String], on_server: bool) {
        let mut kept = Vec::new();
        for path in paths {
            let asked = guard(&self.mirror.deletes).asked.remove(path);
            if !asked {
                continue;
            }
            let deleted = on_server && self.tree_change(TreeChange::Delete { path: path.clone() });
            if !deleted && self.session.keep_away(path).is_ok() {
                kept.push(path.clone());
            }
        }
        self.tell(TreeNoticeKind::KeptAway { paths: kept });
        self.mirror.kick();
    }

    fn moves(
        &self,
        import: &mut LocalImport,
        placed: &super::super::import::Placed,
        disk: &LiveDisk,
    ) {
        let state = guard(&disk.disk).clone();
        let arrived = arrived_paths(import);
        for old in outermost_gone_dirs(import, placed) {
            let Some(new) = folder_arrival(&import.dirs, &arrived, &state, &old) else {
                continue;
            };
            let moved = self.tree_change(TreeChange::Move {
                from: old.clone(),
                to: new.clone(),
            });
            if moved {
                took_folder_move(import, &state, &old, &new);
                import.dirs.retain(|dir| !inside(dir, &new));
            }
        }
        for old in import.removed.clone() {
            let Some(new) = arrival_of(import, placed, &state, &disk.root, &old) else {
                continue;
            };
            let moved = self.tree_change(TreeChange::Move {
                from: old.clone(),
                to: new,
            });
            if moved {
                import.removed.retain(|path| *path != old);
            }
        }
    }

    fn texts(
        &self,
        disk: &LiveDisk,
        texts: Vec<(String, String, String)>,
        placed: &super::super::import::Placed,
    ) {
        let nodes = self.session.nodes();
        for (path, text, hash) in texts {
            match placed.get(&path) {
                Some((_, NodeKind::Text, _)) => self.text_edit(disk, &nodes, path, text, hash),
                Some((_, NodeKind::Dir, _)) => {}
                Some((_, NodeKind::Blob, _)) => {
                    if self.tree_change(TreeChange::Upload { path: path.clone() }) {
                        guard(&disk.disk).hashes.insert(path, hash);
                    }
                }
                None if guard(&disk.disk).hashes.get(&path) == Some(&hash) => {}
                None => {
                    if self.tree_change(TreeChange::NewDoc { path: path.clone() }) {
                        guard(&disk.bases).record(&path, &text);
                        guard(&disk.disk).hashes.insert(path, hash);
                    }
                }
            }
        }
    }

    fn text_edit(
        &self,
        disk: &LiveDisk,
        nodes: &[OverleafNode],
        path: String,
        text: String,
        hash: String,
    ) {
        let Some(doc) = doc_at(nodes, &path) else {
            return;
        };
        let base = guard(&disk.bases).base_for(&path, &text).cloned();
        match self.edit_toward(&doc, &path, base.as_deref(), &text) {
            Ok(Edit::Live) => {}
            Ok(Edit::NotLive) => return,
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Live editing could not send an outside change to {path} in project {}: {error}",
                    disk.project_id
                ));
                return;
            }
        }
        guard(&disk.bases).record(&path, &text);
        guard(&disk.disk).hashes.insert(path, hash);
    }

    fn keep_adopted_under_blobs(&self, next: &Layout) -> Vec<KeptFile> {
        let mut adopted = guard(&self.mirror.adopted);
        if adopted.is_empty() {
            return Vec::new();
        }
        let mut kept = Vec::new();
        for (id, placed) in next {
            if !adopted.remove(&placed.path) || placed.kind != NodeKind::Blob {
                continue;
            }
            let Some(bytes) = safe_target(&self.mirror.disk.root, &placed.path)
                .and_then(|target| std::fs::read(target).ok())
            else {
                continue;
            };
            let hash = sha256_hex(&bytes);
            let adopted_hash = guard(&self.mirror.disk.disk)
                .hashes
                .get(&placed.path)
                .cloned();
            if placed.blob.as_deref() == Some(hash.as_str())
                || adopted_hash.as_deref() != Some(hash.as_str())
            {
                continue;
            }
            match self.mirror.disk.keep_bytes(&placed.path, &bytes, None) {
                Ok(copy) => kept.push(KeptFile {
                    id: id.clone(),
                    path: placed.path.clone(),
                    copy,
                    kind: KeptKind::Differed,
                    by: None,
                }),
                Err(error) => {
                    guard(&self.mirror.disk.disk).hashes.remove(&placed.path);
                    let _ = crate::project::append_app_log(format!(
                        "Live editing could not keep {} in project {} before the server's file of the same name: {error}",
                        placed.path, self.mirror.disk.project_id
                    ));
                }
            }
        }
        kept
    }

    fn announce_stored_as_files(&self) {
        let paths: Vec<String> = guard(&self.mirror.disk.disk)
            .layout
            .values()
            .filter(|placed| placed.kind == NodeKind::Blob)
            .map(|placed| placed.path.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        {
            let mut told = guard(&self.mirror.stored_as_files);
            if *told == paths {
                return;
            }
            told.clone_from(&paths);
        }
        self.mirror.disk.host.overleaf_tree(TreeNotice {
            project_id: self.mirror.disk.project_id.clone(),
            kind: TreeNoticeKind::StoredAsFiles { paths },
        });
    }

    fn announce_removed(&self, previous: &Layout, removed: &[String]) {
        if removed.is_empty() {
            return;
        }
        let mut files = Vec::new();
        let placed_again: BTreeSet<String> = guard(&self.mirror.disk.disk)
            .layout
            .values()
            .map(|placed| placed.path.clone())
            .collect();
        {
            let mut deletes = guard(&self.mirror.deletes);
            let mut kept = guard(&self.mirror.kept);
            let mut removing = guard(&self.mirror.removing);
            removing.retain(|id| {
                previous
                    .get(id)
                    .is_none_or(|placed| !removed.iter().any(|path| inside(&placed.path, path)))
            });
            for path in removed {
                if deletes.mine.remove(path) || placed_again.contains(path) {
                    continue;
                }
                let Some((id, placed)) = previous.iter().find(|(_, placed)| placed.path == *path)
                else {
                    continue;
                };
                let copy = kept
                    .iter()
                    .find(|file| inside(&file.path, path))
                    .map(|file| file.copy.clone());
                files.push(RemovedFile {
                    path: path.clone(),
                    id: id.clone(),
                    kind: placed.kind,
                    by: None,
                    yours: copy.is_some(),
                    copy,
                });
            }
            deletes
                .mine
                .retain(|mine| !removed.iter().any(|path| inside(mine, path)));
            kept.retain(|file| !files.iter().any(|gone| inside(&file.path, &gone.path)));
        }
        guard(&self.mirror.restorable).extend(
            files
                .iter()
                .filter_map(|file| Some((file.path.clone(), file.copy.clone()?))),
        );
        let disk = &self.mirror.disk;
        if !files.is_empty() {
            disk.host.removed(RemovedPayload {
                project_id: disk.project_id.clone(),
                files,
                restored: Vec::new(),
            });
        }
    }

    fn blobs(
        &self,
        disk: &LiveDisk,
        blobs: Vec<(String, String, u64)>,
        placed: &super::super::import::Placed,
    ) {
        for (path, hash, _) in blobs {
            let unknown = matches!(
                placed.get(&path),
                Some((_, NodeKind::Blob, Some(key))) if super::binaries::is_unknown(key)
            );
            let folder = matches!(placed.get(&path), Some((_, NodeKind::Dir, _)));
            let queued = guard(&disk.disk).hashes.get(&path) == Some(&hash);
            if unknown || folder || queued {
                continue;
            }
            if self.tree_change(TreeChange::Upload { path: path.clone() }) {
                guard(&disk.disk).hashes.insert(path, hash);
            }
        }
    }
}

impl TreeRead for OverleafLive {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        let nodes = self.session.nodes();
        let hashes: BTreeMap<&str, Option<&str>> = nodes
            .iter()
            .map(|node| (node.id.0.as_str(), node.hash.as_deref()))
            .collect();
        let placed: BTreeMap<String, String> = guard(&self.mirror.disk.disk)
            .layout
            .iter()
            .map(|(id, placed)| (id.clone(), file_name(&placed.path).to_lowercase()))
            .collect();
        let blobs = guard(&self.mirror.blobs);
        Ok(file_nodes(&nodes)
            .into_iter()
            .map(|mut node| {
                if node.kind == NodeKind::Blob {
                    let hash = hashes.get(node.id.as_str()).copied().flatten();
                    node.blob = Some(blobs.key(hash, &node.id));
                }
                let stayed = placed
                    .get(&node.id)
                    .is_some_and(|name| *name == node.name.to_lowercase());
                node.position = format!("{}{}", u8::from(!stayed), node.name);
                node
            })
            .collect())
    }

    fn text(&self, id: &str) -> Result<Option<String>, CollabError> {
        Ok(self.session.text(&DocId(id.to_owned())))
    }

    fn crlf(&self, _id: &str) -> bool {
        false
    }
}

impl LiveTree for OverleafLive {
    fn read_out(
        &self,
        previous: &mut Layout,
        _hashes: &BTreeMap<String, String>,
    ) -> Result<Option<Outgoing>, CollabError> {
        let work = self.mirror.take_work();
        if work.is_empty() {
            return Ok(None);
        }
        if self.session.tree_settling() {
            self.mirror.mark(work.texts, work.tree);
            return Ok(None);
        }
        let drawn = match LiveDisk::draw(self, &work, previous) {
            Ok(drawn) => drawn,
            Err(error) => {
                self.mirror.mark(work.texts, work.tree);
                return Err(error);
            }
        };
        let kept = self.keep_adopted_under_blobs(&drawn.next);
        Ok(Some(Outgoing {
            work,
            next: drawn.next,
            texts: drawn.texts,
            crlf: drawn.crlf,
            kept,
            copied: false,
        }))
    }

    fn can_edit(&self) -> bool {
        matches!(
            self.mirror.role(),
            Some((ProjectRole::Owner | ProjectRole::Editor, _))
        )
    }

    fn refused(&self, import: &LocalImport) {
        let mut kept = Vec::new();
        for path in &import.removed {
            guard(&self.mirror.deletes).mine.insert(path.clone());
            if self.session.keep_away(path).is_ok() {
                kept.push(path.clone());
            }
        }
        let mut changed: Vec<String> = import
            .texts
            .iter()
            .map(|(path, _, _)| path.clone())
            .chain(import.blobs.iter().map(|(path, _, _)| path.clone()))
            .chain(import.dirs.iter().cloned())
            .collect();
        changed.extend(kept.iter().cloned());
        self.refuse(changed);
        if !kept.is_empty() {
            self.mirror.kick();
        }
    }

    fn open(&self, ids: &[String]) -> BTreeSet<String> {
        let sinks = guard(&self.mirror.sinks);
        ids.iter()
            .filter(|id| sinks.contains_key(&DocId((*id).clone())))
            .cloned()
            .collect()
    }

    fn mark_dirty(&self, ids: &[String]) {
        self.mirror.mark(ids.iter().cloned(), false);
    }

    fn noticed(&self, previous: &Layout, _changed: &BTreeSet<String>, removed: &[String]) {
        self.announce_removed(previous, removed);
        self.announce_stored_as_files();
    }

    fn upload<'a>(
        &'a self,
        _root: &'a Path,
        _blobs: &'a [(String, String, u64)],
    ) -> BoxFuture<'a, BTreeSet<String>> {
        Box::pin(async { BTreeSet::new() })
    }

    fn request_tree(
        &self,
        disk: &LiveDisk,
        change: TreeRequest<'_>,
    ) -> Result<TreeAnswer, CollabError> {
        let TreeRequest { mut import, .. } = change;
        let placed = placed_now(self)?;
        self.moves(&mut import, &placed, disk);
        for dir in std::mem::take(&mut import.dirs) {
            if !placed.contains_key(&dir) {
                self.tree_change(TreeChange::NewFolder { path: dir });
            }
        }
        let LocalImport {
            texts,
            blobs,
            removed,
            restamped,
            ..
        } = import;
        self.texts(disk, texts, &placed);
        self.blobs(disk, blobs, &placed);
        let gone: Vec<String> = removed
            .into_iter()
            .filter(|path| placed.contains_key(path))
            .collect();
        self.ask_to_delete(gone);
        let mut state = guard(&disk.disk);
        for (path, hash) in restamped {
            state.hashes.insert(path, hash);
        }
        Ok(TreeAnswer::Applied)
    }
}
