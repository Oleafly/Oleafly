use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use futures_util::future::BoxFuture;
use oleafly_collab::doc::{FileNode, NodeKind, NodeParent};
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::realtime::tree::{NodeKind as OverleafKind, OverleafNode};
use oleafly_online::realtime::DocId;

use super::{Edit, OverleafLive};
use crate::collab::live::live_tree::{
    LiveTree, Mirror as Outgoing, TreeAnswer, TreeRead, TreeRequest,
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

impl TreeRead for OverleafLive {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        Ok(file_nodes(&self.session.nodes()))
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
        let drawn = match LiveDisk::draw(self, &work, previous) {
            Ok(drawn) => drawn,
            Err(error) => {
                self.mirror.mark(work.texts, work.tree);
                return Err(error);
            }
        };
        Ok(Some(Outgoing {
            work,
            next: drawn.next,
            texts: drawn.texts,
            crlf: drawn.crlf,
            kept: Vec::new(),
            copied: false,
        }))
    }

    fn can_edit(&self) -> bool {
        matches!(
            self.mirror.role(),
            Some((ProjectRole::Owner | ProjectRole::Editor, _))
        )
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

    fn noticed(&self, _previous: &Layout, _changed: &BTreeSet<String>, _removed: &[String]) {}

    fn upload<'a>(
        &'a self,
        _root: &'a Path,
        blobs: &'a [(String, String, u64)],
    ) -> BoxFuture<'a, BTreeSet<String>> {
        Box::pin(async move { blobs.iter().map(|(_, hash, _)| hash.clone()).collect() })
    }

    fn request_tree(
        &self,
        disk: &LiveDisk,
        change: TreeRequest<'_>,
    ) -> Result<TreeAnswer, CollabError> {
        let nodes = self.session.nodes();
        for (path, text, hash) in change.import.texts {
            let Some(doc) = doc_at(&nodes, &path) else {
                continue;
            };
            let base = guard(&disk.bases).base_for(&path, &text).cloned();
            match self.edit_toward(&doc, &path, base.as_deref(), &text) {
                Ok(Edit::Sent | Edit::Same) => {}
                Ok(Edit::NoBase) => continue,
                Err(error) => {
                    let _ = crate::project::append_app_log(format!(
                        "Live editing could not send an outside change to {path} in project {}: {error}",
                        disk.project_id
                    ));
                    continue;
                }
            }
            guard(&disk.bases).record(&path, &text);
            guard(&disk.disk).hashes.insert(path, hash);
        }
        let mut state = guard(&disk.disk);
        for (path, hash) in change.import.restamped {
            state.hashes.insert(path, hash);
        }
        Ok(TreeAnswer::Applied)
    }
}
