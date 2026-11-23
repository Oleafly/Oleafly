use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use futures_util::future::BoxFuture;
use oleafly_collab::doc::{FileNode, NodeKind, NodeParent};
use oleafly_collab::live::DiskWork;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::live::tree_queue::{TreeChange, TreeRefusal};
use oleafly_online::realtime::tree::{NodeKind as OverleafKind, OverleafNode, PathChange};
use oleafly_online::realtime::DocId;

use super::{Edit, Mirror, OverleafLive, TreeNotice, TreeNoticeKind};
use crate::collab::disk::{
    exists_exact, inside, read_text, safe_target, sha256_hex, MAX_SCAN_DEPTH,
};
use crate::collab::live::import::{arrival_of, name_of, placed_now, LocalImport};
use crate::collab::live::kept::{KeptFile, KeptKind};
use crate::collab::live::live_tree::{LiveTree, Outgoing, TreeAnswer, TreeRead, TreeRequest};
use crate::collab::live::moves::{
    arrived_paths, folder_arrival, forget_notice, moved_to, outermost_gone_dirs, paths_under,
    remembered, took_folder_move, RemovedFile, RemovedPayload,
};
use crate::collab::live::session::{guard, LiveDisk};
use crate::collab::live::sync_hold::release_kept;

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

#[derive(Default)]
pub(super) struct Names {
    engine: BTreeMap<String, String>,
    laid: Layout,
    gone: BTreeMap<String, String>,
}

fn raw_path(id: &str, by_id: &BTreeMap<&str, &FileNode>, depth: usize) -> Option<String> {
    let node = by_id.get(id)?;
    match &node.parent {
        NodeParent::Node(parent) if by_id.contains_key(parent.as_str()) => {
            (depth < MAX_SCAN_DEPTH).then_some(())?;
            Some(format!(
                "{}/{}",
                raw_path(parent, by_id, depth + 1)?,
                node.name
            ))
        }
        NodeParent::Root | NodeParent::Node(_) => Some(node.name.clone()),
        NodeParent::Trash => None,
    }
}

fn id_at(paths: &BTreeMap<String, String>, path: &str) -> Option<String> {
    paths
        .iter()
        .find(|(_, at)| *at == path)
        .map(|(id, _)| id.clone())
}

fn joined(parent: &str, path: &str) -> String {
    format!("{parent}/{}", name_of(path))
}

impl Names {
    fn of(nodes: &[FileNode]) -> Names {
        let by_id: BTreeMap<&str, &FileNode> =
            nodes.iter().map(|node| (node.id.as_str(), node)).collect();
        Names {
            gone: BTreeMap::new(),
            engine: nodes
                .iter()
                .filter_map(|node| Some((node.id.clone(), raw_path(&node.id, &by_id, 0)?)))
                .collect(),
            laid: materialize::layout(nodes),
        }
    }

    pub(super) fn follow(&mut self, changes: &[PathChange]) {
        for change in changes {
            match change {
                PathChange::Added { id, path, .. } | PathChange::Moved { id, to: path, .. } => {
                    self.engine.insert(id.0.clone(), path.clone());
                }
                PathChange::Removed { id, path, .. } => {
                    self.engine.remove(&id.0);
                    self.gone.insert(id.0.clone(), path.clone());
                }
                PathChange::Replaced { old, new, path, .. } => {
                    self.engine.remove(&old.0);
                    self.gone.insert(old.0.clone(), path.clone());
                    self.engine.insert(new.0.clone(), path.clone());
                }
            }
        }
    }
}

impl Mirror {
    pub(super) fn files(&self, nodes: &[OverleafNode]) -> Vec<FileNode> {
        let hashes: BTreeMap<&str, Option<&str>> = nodes
            .iter()
            .map(|node| (node.id.0.as_str(), node.hash.as_deref()))
            .collect();
        let placed: BTreeMap<String, String> = guard(&self.disk.disk)
            .layout
            .iter()
            .map(|(id, placed)| (id.clone(), name_of(&placed.path).to_lowercase()))
            .collect();
        let files: Vec<FileNode> = {
            let blobs = guard(&self.blobs);
            file_nodes(nodes)
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
                .collect()
        };
        let fresh = Names::of(&files);
        let mut names = guard(&self.names);
        let gone = std::mem::take(&mut names.gone);
        *names = Names { gone, ..fresh };
        drop(names);
        files
    }

    pub(super) fn laid_path(&self, id: &str) -> Option<String> {
        guard(&self.names)
            .laid
            .get(id)
            .map(|placed| placed.path.clone())
    }

    pub(super) fn doc_at(&self, path: &str) -> Option<DocId> {
        let text_at = |layout: &Layout| {
            layout
                .iter()
                .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
                .map(|(id, _)| DocId(id.clone()))
        };
        let mirrored = text_at(&guard(&self.disk.disk).layout);
        mirrored.or_else(|| text_at(&guard(&self.names).laid))
    }

    pub(super) fn last_path(&self, doc: &DocId) -> Option<String> {
        let gone = guard(&self.names).gone.get(&doc.0).cloned()?;
        Some(self.disk_path(&gone))
    }

    pub(super) fn disk_path(&self, engine: &str) -> String {
        let id = id_at(&guard(&self.names).engine, engine);
        let mirrored = id.as_ref().and_then(|id| {
            guard(&self.disk.disk)
                .layout
                .get(id)
                .map(|placed| placed.path.clone())
        });
        mirrored
            .or_else(|| self.laid_path(id.as_deref()?))
            .unwrap_or_else(|| match engine.rsplit_once('/') {
                Some((parent, _)) => joined(&self.disk_path(parent), engine),
                None => engine.to_owned(),
            })
    }

    pub(super) fn engine_path(&self, disk: &str) -> String {
        let mirrored = guard(&self.disk.disk)
            .layout
            .iter()
            .find(|(_, placed)| placed.path == disk)
            .map(|(id, _)| id.clone());
        let id = mirrored.or_else(|| {
            guard(&self.names)
                .laid
                .iter()
                .find(|(_, placed)| placed.path == disk)
                .map(|(id, _)| id.clone())
        });
        let known = id.and_then(|id| guard(&self.names).engine.get(&id).cloned());
        known.unwrap_or_else(|| match disk.rsplit_once('/') {
            Some((parent, _)) => joined(&self.engine_path(parent), disk),
            None => disk.to_owned(),
        })
    }

    fn to_engine(&self, change: TreeChange) -> TreeChange {
        match change {
            TreeChange::NewDoc { path } => TreeChange::NewDoc {
                path: self.engine_path(&path),
            },
            TreeChange::NewFolder { path } => TreeChange::NewFolder {
                path: self.engine_path(&path),
            },
            TreeChange::Upload { path } => TreeChange::Upload {
                path: self.engine_path(&path),
            },
            TreeChange::Move { from, to } => TreeChange::Move {
                from: self.engine_path(&from),
                to: self.engine_path(&to),
            },
            TreeChange::Delete { path } => TreeChange::Delete {
                path: self.engine_path(&path),
            },
        }
    }

    pub(super) fn read_exact(&self, path: &str) -> Option<(String, String)> {
        exists_exact(&self.disk.root, path)
            .then(|| read_text(&self.disk.root, path))
            .flatten()
    }
}

fn restore_refused(status: u16, code: &str, path: &str) -> CollabError {
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: format!("could not put back {path}"),
    }
}

impl OverleafLive {
    pub(super) fn refresh_names(&self) {
        self.mirror.files(&self.session.nodes());
    }

    fn tree_change(&self, change: TreeChange) -> bool {
        let shown = change.path().to_owned();
        match self.session.change_tree(self.mirror.to_engine(change)) {
            Ok(()) => {
                guard(&self.mirror.deletes).refused.remove(&shown);
                true
            }
            Err(TreeRefusal::NotAllowed) => {
                self.refuse(vec![shown]);
                false
            }
            Err(TreeRefusal::NeverOnline | TreeRefusal::Ended) => false,
            Err(error) => {
                self.mirror.disk.log_once("tree change", || {
                    format!("the service did not take the change to {shown}: {error}")
                });
                false
            }
        }
    }

    fn keep_away(&self, path: &str) -> bool {
        self.session
            .keep_away(&self.mirror.engine_path(path))
            .is_ok()
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
        let notices = self.mirror.disk.notices_file();
        let kept = remembered(&notices)
            .into_iter()
            .find(|notice| notice.path == path && notice.copy.is_some())
            .and_then(|notice| Some((notice.copy?, notice.id)));
        let Some((copy, id)) = kept else {
            return Err(restore_refused(404, "not_found", path));
        };
        let root = self.mirror.disk.root.clone();
        let (from, to) = (copy.clone(), path.to_owned());
        let moved = tauri::async_runtime::spawn_blocking(move || {
            let (Some(source), Some(target)) = (safe_target(&root, &from), safe_target(&root, &to))
            else {
                return Err(std::io::ErrorKind::InvalidInput.into());
            };
            if std::fs::symlink_metadata(&target).is_ok() {
                return Err(std::io::ErrorKind::AlreadyExists.into());
            }
            std::fs::rename(source, target)
        })
        .await
        .map_err(crate::collab::live::session::io)?;
        match moved {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(restore_refused(409, "duplicate_entry", path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                forget_notice(&notices, &id);
                return Err(restore_refused(404, "not_found", path));
            }
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Live editing could not put back {path} from {copy} in project {}: {error}",
                    self.mirror.disk.project_id
                ));
                return Err(crate::collab::live::session::io(error));
            }
        }
        forget_notice(&notices, &id);
        self.import_paths(Some(vec![copy, path.to_owned()])).await
    }

    pub(crate) fn rename_with<R>(
        &self,
        from: &str,
        work: impl FnOnce() -> Result<R, String>,
        landed: impl FnOnce(&R) -> Option<String>,
    ) -> Result<R, String> {
        if !self.can_edit() {
            return work();
        }
        let (known, under) = {
            let disk = guard(&self.mirror.disk.disk);
            let known = disk.layout.values().any(|placed| placed.path == from);
            (known, paths_under(&disk, from))
        };
        if known {
            self.refresh_names();
        }
        let outcome = work()?;
        let Some(to) = landed(&outcome).filter(|_| known) else {
            return Ok(outcome);
        };
        let moved = self.tree_change(TreeChange::Move {
            from: from.to_owned(),
            to: to.clone(),
        });
        if moved {
            for path in under {
                self.mirror.disk.note_own(&path, false);
                self.mirror.disk.note_own(&moved_to(from, &to, &path), true);
            }
            self.mirror.kick();
        }
        Ok(outcome)
    }

    pub(crate) fn decide_deletes(&self, paths: &[String], on_server: bool) {
        let mut kept = Vec::new();
        for path in paths {
            let asked = guard(&self.mirror.deletes).asked.remove(path);
            if !asked {
                continue;
            }
            let deleted = on_server && self.tree_change(TreeChange::Delete { path: path.clone() });
            if !deleted && self.keep_away(path) {
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
        for (path, text, hash) in texts {
            match placed.get(&path) {
                Some((_, NodeKind::Text, _)) => self.text_edit(disk, path, text, hash, None),
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
        path: String,
        text: String,
        hash: String,
        base: Option<String>,
    ) {
        let Some(doc) = self.doc_at(&path) else {
            return;
        };
        let base = base.or_else(|| guard(&disk.bases).base_for(&path, &text).cloned());
        match self.edit_toward(&doc, &path, base.as_deref(), &text) {
            Ok(Edit::Live) => {}
            Ok(Edit::NotLive | Edit::ReadOnly) => return,
            Err(error) => {
                disk.log_once("outside change", || {
                    format!("could not send an outside change to {path}: {error}")
                });
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
                    copy: Some(copy),
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
                    .and_then(|file| file.copy.clone());
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
        if !files.is_empty() {
            *guard(&self.mirror.told) = files
                .iter()
                .filter(|file| !file.yours)
                .flat_map(|file| {
                    previous
                        .iter()
                        .filter(|(_, placed)| {
                            placed.kind == NodeKind::Text && inside(&placed.path, &file.path)
                        })
                        .map(|(text, _)| (text.clone(), file.clone()))
                })
                .collect();
        }
        let disk = &self.mirror.disk;
        let told = (!files.is_empty()).then(|| RemovedPayload {
            project_id: disk.project_id.clone(),
            files,
            restored: Vec::new(),
        });
        disk.tell_removed(previous, told);
    }

    fn texts_while_settling(&self, work: DiskWork, previous: &Layout) -> Option<Outgoing> {
        self.mirror.mark(std::iter::empty(), work.tree);
        let now = self.nodes().map(|nodes| materialize::layout(&nodes));
        let mut texts = Vec::new();
        let mut left = Vec::new();
        for id in work.texts {
            let staying = previous.get(&id).filter(|placed| {
                placed.kind == NodeKind::Text
                    && now
                        .as_ref()
                        .is_ok_and(|now| now.get(&id).is_some_and(|laid| laid.path == placed.path))
            });
            match staying.zip(self.session.text(&DocId(id.clone()))) {
                Some((placed, text)) => texts.push((placed.path.clone(), text)),
                None => left.push(id),
            }
        }
        self.mirror.mark(left, false);
        (!texts.is_empty()).then(|| Outgoing {
            work: DiskWork::default(),
            next: previous.clone(),
            texts,
            crlf: BTreeSet::new(),
            kept: Vec::new(),
            copied: false,
        })
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
        Ok(self.mirror.files(&self.session.nodes()))
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
            return Ok(self.texts_while_settling(work, previous));
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
            if self.keep_away(path) {
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
        let TreeRequest {
            mut import,
            edits,
            hold_dir,
        } = change;
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
        for (path, text, hash, base) in release_kept(hold_dir, edits) {
            self.text_edit(disk, path, text, hash, Some(base));
        }
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
