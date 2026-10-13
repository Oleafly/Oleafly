use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use loro::event::{Diff, DiffBatch};
use loro::{
    ContainerID, EncodedBlobMode, ExportMode, LoroDoc, LoroMap, LoroText, LoroTree, LoroValue,
    TextDelta, TreeID, TreeParentId, UpdateOptions, ValueOrContainer, VersionVector, ID,
};
use oleafly_collab_protocol::ids::FileId;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};

use crate::ot::{Component, TextOperation};
use crate::CollabError;

mod tree;

pub use tree::{LostRename, Trashed};

const TREE: &str = "tree";
const META: &str = "meta";
const TEXT_PREFIX: &str = "text:";
pub const TRASH_ID: &str = "~trash";
const UPDATE_TIMEOUT_MS: f64 = 2_000.0;
const LINE_ENDING: &str = "eol";
const CRLF: &str = "crlf";
const BLOB_WAS: &str = "blob_was";
const BLOB_BY: &str = "blob_by:";
const STAGED_IMPORT_BYTES: usize = 64 * 1024;
const STAGE_ATOMS: i32 = 16_384;

struct Staged {
    pieces: Vec<Vec<u8>>,
    target: VersionVector,
    arrived: Vec<(u64, i32)>,
}

fn export_spans(
    doc: &LoroDoc,
    spans: &std::collections::BTreeMap<u64, (i32, i32)>,
) -> Option<Vec<u8>> {
    let spans: Vec<loro::IdSpan> = spans
        .iter()
        .map(|(peer, (from, to))| loro::IdSpan::new(*peer, *from, *to))
        .collect();
    doc.export(ExportMode::UpdatesInRange {
        spans: std::borrow::Cow::Owned(spans),
    })
    .ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Dir,
    Text,
    Blob,
}

impl NodeKind {
    fn as_str(self) -> &'static str {
        match self {
            NodeKind::Dir => "dir",
            NodeKind::Text => "text",
            NodeKind::Blob => "blob",
        }
    }

    fn parse(value: &str) -> Option<NodeKind> {
        match value {
            "dir" => Some(NodeKind::Dir),
            "text" => Some(NodeKind::Text),
            "blob" => Some(NodeKind::Blob),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum NodeParent {
    Root,
    Trash,
    Node(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileNode {
    pub id: String,
    pub parent: NodeParent,
    pub name: String,
    pub kind: NodeKind,
    pub blob: Option<String>,
    pub position: String,
    pub author_name: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct DocChanges {
    pub texts: Vec<(String, Vec<TextDelta>)>,
    pub tree: bool,
    pub comments: crate::comments::CommentEvents,
}

impl DocChanges {
    pub fn is_empty(&self) -> bool {
        self.texts.is_empty() && !self.tree && self.comments.is_empty()
    }
}

#[derive(Debug, Default)]
pub struct Imported {
    pub changes: DocChanges,
    pub arrived: Vec<(u64, i32)>,
    pub pending: bool,
}

impl Imported {
    fn absorb(&mut self, later: Imported) {
        self.changes.texts.extend(later.changes.texts);
        self.changes.tree |= later.changes.tree;
        self.changes.comments.extend(later.changes.comments);
        self.arrived.extend(later.arrived);
        self.pending |= later.pending;
    }
}

#[derive(Default)]
struct Recorder {
    on: bool,
    changes: DocChanges,
}

type SharedRecorder = Arc<Mutex<Recorder>>;

fn recorder(doc: &LoroDoc) -> (SharedRecorder, loro::Subscription) {
    let shared: SharedRecorder = Arc::new(Mutex::new(Recorder::default()));
    let sink = Arc::clone(&shared);
    let subscription = doc.subscribe_root(Arc::new(move |event| {
        let mut recorder = sink.lock().unwrap_or_else(PoisonError::into_inner);
        if !recorder.on {
            return;
        }
        for change in &event.events {
            if crate::comments::record(&mut recorder.changes.comments, change) {
                continue;
            }
            match (change.target, &change.diff) {
                (ContainerID::Root { name, .. }, Diff::Text(deltas)) => {
                    if let Some(id) = name.as_str().strip_prefix(TEXT_PREFIX) {
                        recorder.changes.texts.push((id.to_owned(), deltas.clone()));
                    }
                }
                (_, Diff::Text(_)) => {}
                _ => recorder.changes.tree = true,
            }
        }
    }));
    (shared, subscription)
}

pub struct ProjectDoc {
    doc: LoroDoc,
    tree: LoroTree,
    ids: HashMap<String, TreeID>,
    trash: Option<TreeID>,
    log: tree::TreeLog,
    authors: crate::comments::Authorship,
    anchors: Mutex<crate::comments::Anchors>,
    recorded: SharedRecorder,
    compacted_with: VersionVector,
    _events: loro::Subscription,
}

fn doc_error<T: std::fmt::Debug>(error: T) -> CollabError {
    CollabError::Corrupt(format!("{error:?}"))
}

fn fresh_peer() -> Result<u64, CollabError> {
    let mut bytes = [0u8; 8];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| CollabError::Crypto("could not draw a random peer id".to_owned()))?;
    Ok(u64::from_le_bytes(bytes) >> 1)
}

fn meta_string(meta: &LoroMap, key: &str) -> Option<String> {
    match meta.get(key) {
        Some(ValueOrContainer::Value(LoroValue::String(value))) => Some(value.as_str().to_owned()),
        _ => None,
    }
}

fn text_name(id: &str) -> String {
    format!("{TEXT_PREFIX}{id}")
}

pub fn delta_to_operation(old: &str, deltas: &[TextDelta]) -> Result<TextOperation, CollabError> {
    let mut characters = old.chars();
    let mut take = |count: usize| -> Result<usize, CollabError> {
        let mut units = 0;
        for _ in 0..count {
            units += characters
                .next()
                .ok_or_else(|| {
                    CollabError::Corrupt("a change runs past the end of its file".to_owned())
                })?
                .len_utf16();
        }
        Ok(units)
    };
    let mut operation = TextOperation::new();
    for delta in deltas {
        match delta {
            TextDelta::Retain { retain, .. } => {
                operation.retain(take(*retain)?);
            }
            TextDelta::Insert { insert, .. } => {
                operation.insert(insert);
            }
            TextDelta::Delete { delete } => {
                operation.delete(take(*delete)?);
            }
        }
    }
    let rest: usize = characters.map(char::len_utf16).sum();
    operation.retain(rest);
    Ok(operation)
}

impl ProjectDoc {
    pub fn create() -> Result<ProjectDoc, CollabError> {
        let doc = LoroDoc::new();
        doc.set_peer_id(fresh_peer()?).map_err(doc_error)?;
        let tree = doc.get_tree(TREE);
        tree.enable_fractional_index(0);
        let trash = tree.create(TreeParentId::Root).map_err(doc_error)?;
        let meta = tree.get_meta(trash).map_err(doc_error)?;
        meta.insert("id", TRASH_ID).map_err(doc_error)?;
        meta.insert("name", TRASH_ID).map_err(doc_error)?;
        meta.insert("kind", NodeKind::Dir.as_str())
            .map_err(doc_error)?;
        doc.commit();
        let (recorded, events) = recorder(&doc);
        Ok(ProjectDoc {
            doc,
            tree,
            ids: HashMap::new(),
            trash: Some(trash),
            log: tree::TreeLog::default(),
            authors: crate::comments::Authorship::default(),
            anchors: Mutex::default(),
            recorded,
            compacted_with: VersionVector::new(),
            _events: events,
        })
    }

    pub fn load(bytes: &[u8]) -> Result<ProjectDoc, CollabError> {
        let doc = LoroDoc::new();
        doc.set_peer_id(fresh_peer()?).map_err(doc_error)?;
        doc.import(bytes).map_err(doc_error)?;
        let loaded = ProjectDoc::wrap(doc)?;
        if loaded.trash.is_none() {
            return Err(CollabError::Corrupt(
                "the shared project has no trash folder".to_owned(),
            ));
        }
        Ok(loaded)
    }

    fn wrap(doc: LoroDoc) -> Result<ProjectDoc, CollabError> {
        let tree = doc.get_tree(TREE);
        tree.enable_fractional_index(0);
        let (recorded, events) = recorder(&doc);
        let mut wrapped = ProjectDoc {
            doc,
            tree,
            ids: HashMap::new(),
            trash: None,
            log: tree::TreeLog::default(),
            authors: crate::comments::Authorship::default(),
            anchors: Mutex::default(),
            recorded,
            compacted_with: VersionVector::new(),
            _events: events,
        };
        wrapped.reindex()?;
        Ok(wrapped)
    }

    pub fn at_version(&self, version: &VersionVector) -> Result<ProjectDoc, CollabError> {
        if !self.doc.oplog_vv().includes_vv(version) {
            return Err(CollabError::Corrupt(
                "the shared project never had this version".to_owned(),
            ));
        }
        let frontiers = self.doc.vv_to_frontiers(version);
        ProjectDoc::wrap(self.doc.fork_at(&frontiers).map_err(doc_error)?)
    }

    pub fn without_comment_changes_after(
        &mut self,
        base: &VersionVector,
    ) -> Result<Option<Vec<crate::comments::UnsentComment>>, CollabError> {
        if !self.doc.oplog_vv().includes_vv(base) {
            return Err(CollabError::Corrupt(
                "the shared project never had this version".to_owned(),
            ));
        }
        if !changes_comments_after(&self.doc, base) {
            return Ok(None);
        }
        let from = self.doc.vv_to_frontiers(base);
        let to = self.doc.oplog_frontiers();
        let mut kept = DiffBatch::default();
        for (container, change) in self.doc.diff(&from, &to).map_err(doc_error)?.iter() {
            if crate::comments::in_comments(&self.doc, container) {
                continue;
            }
            kept.push(container.clone(), change.clone())
                .map_err(|_| CollabError::Corrupt("a change was listed twice".to_owned()))?;
        }
        let fork = self.doc.fork_at(&from).map_err(doc_error)?;
        fork.set_peer_id(fresh_peer()?).map_err(doc_error)?;
        fork.apply_diff(kept).map_err(doc_error)?;
        fork.commit();
        let mut rebuilt = ProjectDoc::wrap(fork)?;
        if !self.same_files_as(&rebuilt)? {
            return Err(CollabError::Corrupt(
                "the project changed while comments were taken out of it".to_owned(),
            ));
        }
        let unsent = crate::comments::unsent_comments(self, &rebuilt);
        rebuilt.log = std::mem::take(&mut self.log);
        rebuilt.authors = std::mem::take(&mut self.authors);
        *self = rebuilt;
        Ok(Some(unsent))
    }

    fn same_files_as(&self, other: &ProjectDoc) -> Result<bool, CollabError> {
        let sorted = |doc: &ProjectDoc| -> Result<Vec<FileNode>, CollabError> {
            let mut nodes = doc.nodes()?;
            nodes.sort_by(|left, right| left.id.cmp(&right.id));
            Ok(nodes)
        };
        let nodes = sorted(self)?;
        if nodes != sorted(other)? {
            return Ok(false);
        }
        for node in nodes.iter().filter(|node| node.kind == NodeKind::Text) {
            if self.text(&node.id)? != other.text(&node.id)? {
                return Ok(false);
            }
        }
        Ok(self.doc.get_map(META).get_deep_value() == other.doc.get_map(META).get_deep_value())
    }

    fn reindex(&mut self) -> Result<(), CollabError> {
        let mut ids = HashMap::new();
        let mut trash: Option<TreeID> = None;
        for node in self.tree.get_nodes(false) {
            let meta = self.tree.get_meta(node.id).map_err(doc_error)?;
            match meta_string(&meta, "id") {
                Some(id) if id == TRASH_ID => {
                    trash = Some(trash.map_or(node.id, |current| current.min(node.id)));
                }
                Some(id) => {
                    ids.insert(id, node.id);
                }
                None => {}
            }
        }
        self.ids = ids;
        self.trash = trash;
        Ok(())
    }

    fn tree_id(&self, id: &str) -> Result<TreeID, CollabError> {
        self.ids
            .get(id)
            .copied()
            .ok_or_else(|| CollabError::Corrupt(format!("the shared project has no file {id}")))
    }

    fn parent_of(&self, parent: Option<&str>) -> Result<TreeParentId, CollabError> {
        match parent {
            None => Ok(TreeParentId::Root),
            Some(id) => Ok(TreeParentId::Node(self.tree_id(id)?)),
        }
    }

    pub(crate) fn loro(&self) -> &LoroDoc {
        &self.doc
    }

    pub(crate) fn authors(&self) -> &crate::comments::Authorship {
        &self.authors
    }

    pub(crate) fn authors_mut(&mut self) -> &mut crate::comments::Authorship {
        &mut self.authors
    }

    pub(crate) fn anchors(&self) -> std::sync::MutexGuard<'_, crate::comments::Anchors> {
        self.anchors.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn text_of(&self, id: &str) -> Result<LoroText, CollabError> {
        self.tree_id(id)?;
        Ok(self.doc.get_text(text_name(id)))
    }

    pub fn contains(&self, id: &str) -> bool {
        self.ids.contains_key(id)
    }

    pub fn add_node(
        &mut self,
        parent: Option<&str>,
        name: &str,
        kind: NodeKind,
        blob: Option<&str>,
        text: &str,
    ) -> Result<String, CollabError> {
        let id = FileId::new_v7().to_string();
        let parent = self.parent_of(parent)?;
        let created = self.tree.create(parent).map_err(doc_error)?;
        let meta = self.tree.get_meta(created).map_err(doc_error)?;
        meta.insert("id", id.as_str()).map_err(doc_error)?;
        meta.insert("name", name).map_err(doc_error)?;
        meta.insert("kind", kind.as_str()).map_err(doc_error)?;
        self.log.created(&meta)?;
        if let Some(hash) = blob {
            meta.insert("blob", hash).map_err(doc_error)?;
        }
        if kind == NodeKind::Text && !text.is_empty() {
            self.doc
                .get_text(text_name(&id))
                .insert_utf16(0, text)
                .map_err(doc_error)?;
        }
        self.doc.commit();
        self.ids.insert(id.clone(), created);
        Ok(id)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), CollabError> {
        let node = self.tree_id(id)?;
        let meta = self.tree.get_meta(node).map_err(doc_error)?;
        self.log.renaming(id, &meta, name)?;
        meta.insert("name", name).map_err(doc_error)?;
        self.doc.commit();
        Ok(())
    }

    pub fn set_blob(&mut self, id: &str, hash: &str) -> Result<(), CollabError> {
        let node = self.tree_id(id)?;
        let meta = self.tree.get_meta(node).map_err(doc_error)?;
        let was = meta_string(&meta, "blob");
        let setters: Vec<String> = meta
            .keys()
            .filter(|key| key.starts_with(BLOB_BY))
            .map(|key| key.to_string())
            .collect();
        for key in setters {
            meta.delete(&key).map_err(doc_error)?;
        }
        meta.insert("blob", hash).map_err(doc_error)?;
        match was {
            Some(was) => meta.insert(BLOB_WAS, was).map_err(doc_error)?,
            None if meta.get(BLOB_WAS).is_some() => meta.delete(BLOB_WAS).map_err(doc_error)?,
            None => {}
        }
        if let Some(account) = self.author_key() {
            meta.insert(&format!("{BLOB_BY}{hash}"), account)
                .map_err(doc_error)?;
        }
        self.doc.commit();
        Ok(())
    }

    pub fn blob_was(&self, id: &str) -> Option<String> {
        let meta = self.tree.get_meta(self.tree_id(id).ok()?).ok()?;
        meta_string(&meta, BLOB_WAS)
    }

    pub fn blob_setter(&self, id: &str, hash: &str) -> Option<String> {
        let meta = self.tree.get_meta(self.tree_id(id).ok()?).ok()?;
        meta_string(&meta, &format!("{BLOB_BY}{hash}"))
    }

    pub fn author_of(&self, id: &str) -> Option<String> {
        let meta = self.tree.get_meta(self.tree_id(id).ok()?).ok()?;
        meta_string(&meta, "author")
    }

    pub fn crlf(&self, id: &str) -> bool {
        self.tree_id(id)
            .ok()
            .and_then(|node| self.tree.get_meta(node).ok())
            .and_then(|meta| meta_string(&meta, LINE_ENDING))
            .is_some_and(|value| value == CRLF)
    }

    pub fn set_crlf(&mut self, id: &str, crlf: bool) -> Result<bool, CollabError> {
        if self.crlf(id) == crlf {
            return Ok(false);
        }
        let meta = self.tree.get_meta(self.tree_id(id)?).map_err(doc_error)?;
        if crlf {
            meta.insert(LINE_ENDING, CRLF).map_err(doc_error)?;
        } else {
            meta.delete(LINE_ENDING).map_err(doc_error)?;
        }
        self.doc.commit();
        Ok(true)
    }

    pub fn move_to(&mut self, id: &str, parent: Option<&str>) -> Result<(), CollabError> {
        let node = self.tree_id(id)?;
        let parent = self.parent_of(parent)?;
        self.tree.mov(node, parent).map_err(doc_error)?;
        self.doc.commit();
        Ok(())
    }

    pub fn trash(&mut self, id: &str) -> Result<(), CollabError> {
        let node = self.tree_id(id)?;
        let trash = self.trash.ok_or_else(|| {
            CollabError::Corrupt("the shared project has no trash folder".to_owned())
        })?;
        self.stamp_trashed(node)?;
        self.tree
            .mov(node, TreeParentId::Node(trash))
            .map_err(doc_error)?;
        self.doc.commit();
        Ok(())
    }

    pub fn text(&self, id: &str) -> Result<String, CollabError> {
        Ok(self.text_of(id)?.to_string())
    }

    pub fn apply_operation(
        &mut self,
        id: &str,
        operation: &TextOperation,
    ) -> Result<(), CollabError> {
        let text = self.text_of(id)?;
        if text.len_utf16() != operation.base_len() {
            return Err(CollabError::Corrupt(format!(
                "a change for {id} does not fit its text"
            )));
        }
        let mut position = 0;
        for component in operation.components() {
            match component {
                Component::Retain(count) => position += count,
                Component::Insert(inserted) => {
                    text.insert_utf16(position, inserted).map_err(doc_error)?;
                    position += crate::ot::utf16_len(inserted);
                }
                Component::Delete(count) => {
                    text.delete_utf16(position, *count).map_err(doc_error)?;
                }
            }
        }
        self.doc.commit();
        Ok(())
    }

    pub fn set_text(&mut self, id: &str, content: &str) -> Result<DocChanges, CollabError> {
        let text = self.text_of(id)?;
        let options = UpdateOptions {
            timeout_ms: Some(UPDATE_TIMEOUT_MS),
            use_refined_diff: true,
        };
        let (_, changes) = self.recording(|doc| {
            if text.update(content, options).is_err() {
                let length = text.len_utf16();
                text.splice_utf16(0, length, content).map_err(doc_error)?;
            }
            doc.commit();
            Ok(())
        })?;
        Ok(changes)
    }

    fn recording<T>(
        &self,
        work: impl FnOnce(&LoroDoc) -> Result<T, CollabError>,
    ) -> Result<(T, DocChanges), CollabError> {
        self.doc.commit();
        {
            let mut recorder = self.recorded.lock().unwrap_or_else(PoisonError::into_inner);
            recorder.on = true;
            recorder.changes = DocChanges::default();
        }
        let outcome = work(&self.doc);
        let mut recorder = self.recorded.lock().unwrap_or_else(PoisonError::into_inner);
        recorder.on = false;
        let changes = std::mem::take(&mut recorder.changes);
        Ok((outcome?, changes))
    }

    pub fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        let by_tree: HashMap<TreeID, &str> = self
            .ids
            .iter()
            .map(|(id, node)| (*node, id.as_str()))
            .collect();
        let mut views = Vec::new();
        for node in self.tree.get_nodes(false) {
            let Some(id) = by_tree.get(&node.id) else {
                continue;
            };
            let parent = match node.parent {
                TreeParentId::Root => NodeParent::Root,
                TreeParentId::Node(parent) if Some(parent) == self.trash => NodeParent::Trash,
                TreeParentId::Node(parent) => match by_tree.get(&parent) {
                    Some(parent_id) => NodeParent::Node((*parent_id).to_owned()),
                    None => NodeParent::Trash,
                },
                _ => continue,
            };
            let meta = self.tree.get_meta(node.id).map_err(doc_error)?;
            views.push(FileNode {
                id: (*id).to_owned(),
                parent,
                name: meta_string(&meta, "name").unwrap_or_default(),
                kind: meta_string(&meta, "kind")
                    .and_then(|kind| NodeKind::parse(&kind))
                    .unwrap_or(NodeKind::Text),
                blob: meta_string(&meta, "blob"),
                position: node.fractional_index.to_string(),
                author_name: meta_string(&meta, "author_name"),
            });
        }
        Ok(views)
    }

    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<(), CollabError> {
        self.doc
            .get_map(META)
            .insert(key, value)
            .map_err(doc_error)?;
        self.doc.commit();
        Ok(())
    }

    pub fn meta(&self, key: &str) -> Option<String> {
        meta_string(&self.doc.get_map(META), key)
    }

    pub fn pending_since(&self, version: &VersionVector) -> u64 {
        self.doc
            .oplog_vv()
            .iter()
            .map(|(peer, end)| {
                let confirmed = version.get(peer).copied().unwrap_or(0);
                u64::try_from(end - confirmed).unwrap_or(0)
            })
            .sum()
    }

    pub fn version(&self) -> VersionVector {
        self.doc.oplog_vv()
    }

    pub fn has_changes_since(&self, version: &VersionVector) -> bool {
        !version.includes_vv(&self.doc.oplog_vv())
    }

    pub fn export_since(&self, version: &VersionVector) -> Result<Vec<u8>, CollabError> {
        self.doc
            .export(ExportMode::updates(version))
            .map_err(doc_error)
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, CollabError> {
        self.doc.export(ExportMode::Snapshot).map_err(doc_error)
    }

    pub fn peer_id(&self) -> u64 {
        self.doc.peer_id()
    }

    pub fn introduced_peers(&self, payload: &[u8]) -> Result<Vec<u64>, CollabError> {
        let meta = LoroDoc::decode_import_blob_meta(payload, true).map_err(doc_error)?;
        if meta.mode != EncodedBlobMode::Updates {
            return Err(CollabError::Corrupt(
                "a change arrived as something other than an update".to_owned(),
            ));
        }
        let known = self.doc.oplog_vv();
        Ok(meta
            .partial_end_vv
            .iter()
            .filter(|(peer, end)| known.get(peer).copied().unwrap_or(0) < **end)
            .map(|(peer, _)| *peer)
            .collect())
    }

    pub fn import(&mut self, bytes: &[u8]) -> Result<Imported, CollabError> {
        self.import_all(&[bytes])
    }

    pub fn texts_changed_in(&self, spans: &[(u64, i32, i32)]) -> Vec<String> {
        let mut texts: Vec<String> = spans
            .iter()
            .filter(|(_, from, to)| from < to)
            .flat_map(|(peer, from, to)| {
                self.doc.get_changed_containers_in(
                    ID::new(*peer, *from),
                    usize::try_from(to - from).unwrap_or(0),
                )
            })
            .filter_map(|container| match container {
                ContainerID::Root { name, .. } => name.strip_prefix(TEXT_PREFIX).map(str::to_owned),
                _ => None,
            })
            .collect();
        texts.sort_unstable();
        texts.dedup();
        texts
    }

    pub fn import_all(&mut self, payloads: &[&[u8]]) -> Result<Imported, CollabError> {
        let mut imported = Imported::default();
        let mut together: Vec<Vec<u8>> = Vec::new();
        for payload in payloads {
            if payload.len() >= STAGED_IMPORT_BYTES {
                self.import_together(std::mem::take(&mut together), &mut imported)?;
                let alone = self.import_one(payload)?;
                imported.absorb(alone);
            } else {
                together.push(payload.to_vec());
            }
        }
        self.import_together(together, &mut imported)?;
        self.compact_for_new_writers()?;
        Ok(imported)
    }

    fn import_together(
        &mut self,
        payloads: Vec<Vec<u8>>,
        imported: &mut Imported,
    ) -> Result<(), CollabError> {
        if payloads.is_empty() {
            return Ok(());
        }
        let (status, changes) =
            self.recording(|doc| doc.import_batch(&payloads).map_err(doc_error))?;
        if changes.tree {
            self.reindex()?;
            self.log.tree_changed();
        }
        imported.absorb(Imported {
            changes,
            arrived: status
                .success
                .iter()
                .map(|(peer, (_, end))| (*peer, *end))
                .collect(),
            pending: status.pending.is_some(),
        });
        Ok(())
    }

    fn compact_for_new_writers(&mut self) -> Result<(), CollabError> {
        let now = self.doc.oplog_vv();
        if now
            .iter()
            .all(|(peer, _)| self.compacted_with.get(peer).is_some())
        {
            return Ok(());
        }
        self.doc.export(ExportMode::Snapshot).map_err(doc_error)?;
        self.compacted_with = now;
        Ok(())
    }

    fn import_one(&mut self, bytes: &[u8]) -> Result<Imported, CollabError> {
        let staged = if bytes.len() >= STAGED_IMPORT_BYTES {
            self.staged(bytes)
        } else {
            None
        };
        let (arrived, pending, changes) = match staged {
            Some(staged) => {
                let (_, changes) = self.recording(|doc| {
                    for piece in &staged.pieces {
                        doc.import(piece).map_err(doc_error)?;
                    }
                    if !doc.oplog_vv().includes_vv(&staged.target) {
                        doc.import(bytes).map_err(doc_error)?;
                    }
                    Ok(())
                })?;
                (staged.arrived, false, changes)
            }
            None => {
                let (status, changes) =
                    self.recording(|doc| doc.import(bytes).map_err(doc_error))?;
                let arrived = status
                    .success
                    .iter()
                    .map(|(peer, (_, end))| (*peer, *end))
                    .collect();
                (arrived, status.pending.is_some(), changes)
            }
        };
        if changes.tree {
            self.reindex()?;
            self.log.tree_changed();
        }
        Ok(Imported {
            changes,
            arrived,
            pending,
        })
    }

    fn staged(&self, bytes: &[u8]) -> Option<Staged> {
        if self.doc.oplog_vv().is_empty() {
            return None;
        }
        let scratch = self.doc.fork();
        scratch.detach();
        let status = scratch.import(bytes).ok()?;
        if status.pending.is_some() {
            return None;
        }
        let known = self.doc.oplog_vv();
        let target = scratch.oplog_vv();
        let mut chunks: Vec<(u32, u64, i32, i32)> = Vec::new();
        for (peer, end) in target.iter() {
            let mut counter = known.get(peer).copied().unwrap_or(0);
            while counter < *end {
                let change = scratch.get_change(ID::new(*peer, counter))?;
                let start = change.id.counter;
                let change_end = start
                    .saturating_add(i32::try_from(change.len).unwrap_or(i32::MAX))
                    .min(*end);
                if change_end <= counter {
                    return None;
                }
                while counter < change_end {
                    let to = counter.saturating_add(STAGE_ATOMS).min(change_end);
                    let lamport = change
                        .lamport
                        .saturating_add(u32::try_from(counter - start).unwrap_or(0));
                    chunks.push((lamport, *peer, counter, to));
                    counter = to;
                }
            }
        }
        chunks.sort_unstable();
        let mut pieces = Vec::new();
        let mut spans: std::collections::BTreeMap<u64, (i32, i32)> =
            std::collections::BTreeMap::new();
        let mut atoms = 0;
        for (_, peer, from, to) in chunks {
            let span = spans.entry(peer).or_insert((from, from));
            span.1 = to;
            atoms += to - from;
            if atoms >= STAGE_ATOMS {
                pieces.push(export_spans(&scratch, &std::mem::take(&mut spans))?);
                atoms = 0;
            }
        }
        if !spans.is_empty() {
            pieces.push(export_spans(&scratch, &spans)?);
        }
        let arrived = status
            .success
            .iter()
            .map(|(peer, (_, end))| (*peer, *end))
            .collect();
        Some(Staged {
            pieces,
            target,
            arrived,
        })
    }
}

pub(crate) fn changes_comments_after(doc: &LoroDoc, base: &VersionVector) -> bool {
    doc.oplog_vv().iter().any(|(peer, end)| {
        let start = base.get(peer).copied().unwrap_or(0);
        start < *end
            && doc
                .get_changed_containers_in(
                    ID::new(*peer, start),
                    usize::try_from(end - start).unwrap_or(0),
                )
                .iter()
                .any(|container| crate::comments::in_comments(doc, container))
    })
}

pub fn advance(version: &mut VersionVector, arrived: &[(u64, i32)]) {
    for (peer, end) in arrived {
        if version.get(peer).is_none_or(|current| current < end) {
            version.set_end(ID::new(*peer, *end));
        }
    }
}

pub fn encode_version(version: &VersionVector) -> Vec<u8> {
    version.encode()
}

pub fn decode_version(bytes: &[u8]) -> Result<VersionVector, CollabError> {
    if bytes.is_empty() {
        return Ok(VersionVector::new());
    }
    VersionVector::decode(bytes).map_err(doc_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared_pair() -> (ProjectDoc, ProjectDoc, String) {
        let mut owner = ProjectDoc::create().unwrap();
        let main = owner
            .add_node(None, "main.tex", NodeKind::Text, None, "Hello world\n")
            .unwrap();
        let joiner = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        (owner, joiner, main)
    }

    fn next(seed: &mut u64) -> u64 {
        *seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        *seed >> 33
    }

    fn applied(text: &str, operation: &TextOperation) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut out: Vec<u16> = Vec::new();
        let mut at = 0;
        for component in operation.components() {
            match component {
                Component::Retain(count) => {
                    out.extend_from_slice(&units[at..at + count]);
                    at += count;
                }
                Component::Insert(inserted) => out.extend(inserted.encode_utf16()),
                Component::Delete(count) => at += count,
            }
        }
        out.extend_from_slice(&units[at..]);
        String::from_utf16(&out).unwrap()
    }

    #[test]
    fn a_file_marked_as_crlf_keeps_the_mark_in_every_copy_until_it_is_cleared() {
        let (mut owner, mut joiner, main) = shared_pair();
        assert!(!owner.crlf(&main));
        assert!(owner.set_crlf(&main, true).unwrap());
        assert!(!owner.set_crlf(&main, true).unwrap());
        joiner
            .import(&owner.export_since(&joiner.version()).unwrap())
            .unwrap();
        assert!(joiner.crlf(&main));
        assert!(joiner.set_crlf(&main, false).unwrap());
        owner
            .import(&joiner.export_since(&owner.version()).unwrap())
            .unwrap();
        assert!(!owner.crlf(&main));
        assert!(!owner.crlf("no-such-file"));
        assert_eq!(owner.text(&main).unwrap(), "Hello world\n");
    }

    #[test]
    fn an_import_reports_exactly_the_text_and_tree_changes_it_made() {
        let mut seed = 11u64;
        let mut writer = ProjectDoc::create().unwrap();
        let main = writer
            .add_node(None, "main.tex", NodeKind::Text, None, "Hello world\n")
            .unwrap();
        let notes = writer
            .add_node(None, "notes.md", NodeKind::Text, None, "日本語 notes 🪸\n")
            .unwrap();
        let mut reader = ProjectDoc::load(&writer.snapshot().unwrap()).unwrap();
        let pieces = ["a", "é", "🪸", "line\n", "コーラル", " "];
        for round in 0..300 {
            let before = writer.version();
            for _ in 0..1 + next(&mut seed) % 4 {
                let id = if next(&mut seed).is_multiple_of(2) {
                    &main
                } else {
                    &notes
                };
                let text = writer.text(id).unwrap();
                let chars: Vec<char> = text.chars().collect();
                let at = (next(&mut seed) as usize) % (chars.len() + 1);
                let prefix: String = chars[..at].iter().collect();
                let rest: String = chars[at..].iter().collect();
                let mut operation = TextOperation::default();
                operation.retain(prefix.encode_utf16().count());
                if next(&mut seed).is_multiple_of(3) && !rest.is_empty() {
                    let gone: String = rest
                        .chars()
                        .take(1 + next(&mut seed) as usize % 3)
                        .collect();
                    operation.delete(gone.encode_utf16().count());
                    operation.retain(rest.encode_utf16().count() - gone.encode_utf16().count());
                } else {
                    operation.insert(pieces[next(&mut seed) as usize % pieces.len()]);
                    operation.retain(rest.encode_utf16().count());
                }
                writer.apply_operation(id, &operation).unwrap();
            }
            let renamed = round % 50 == 49;
            if renamed {
                writer.rename(&notes, &format!("notes-{round}.md")).unwrap();
            }
            let update = writer.export_since(&before).unwrap();
            let main_before = reader.text(&main).unwrap();
            let notes_before = reader.text(&notes).unwrap();
            let imported = reader.import(&update).unwrap();
            let mut main_after = main_before.clone();
            let mut notes_after = notes_before.clone();
            for (id, deltas) in &imported.changes.texts {
                let target = if id == &main {
                    &mut main_after
                } else {
                    &mut notes_after
                };
                let operation = delta_to_operation(target, deltas).unwrap();
                *target = applied(target, &operation);
            }
            assert_eq!(main_after, reader.text(&main).unwrap(), "round {round}");
            assert_eq!(notes_after, reader.text(&notes).unwrap(), "round {round}");
            assert_eq!(imported.changes.tree, renamed, "round {round}");
        }
        assert_eq!(reader.text(&main).unwrap(), writer.text(&main).unwrap());
        assert_eq!(reader.nodes().unwrap(), writer.nodes().unwrap());
    }

    #[test]
    fn a_large_update_from_two_people_reports_changes_that_rebuild_every_text() {
        let (mut alice, mut bob, main) = shared_pair();
        let mut carol = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
        let since = bob.version();
        bob.apply_operation(&main, &{
            let mut operation = TextOperation::default();
            operation.insert("Bob: ").retain(12);
            operation
        })
        .unwrap();
        let big: String = (0..3_000)
            .map(|line| format!("Ligne {line} — 日本語 🪸 data\n"))
            .collect();
        let refs = alice
            .add_node(None, "refs.bib", NodeKind::Text, None, &big)
            .unwrap();
        alice
            .apply_operation(&main, &{
                let mut operation = TextOperation::default();
                operation.retain(6).insert("Alice ").retain(6);
                operation
            })
            .unwrap();
        let paste: String = "carol pasted this line\n".repeat(2_000);
        carol
            .apply_operation(&main, &{
                let mut operation = TextOperation::default();
                operation.retain(12).insert(&paste);
                operation
            })
            .unwrap();
        alice
            .import(&carol.export_since(&alice.version()).unwrap())
            .unwrap();
        let payload = alice.export_since(&since).unwrap();
        assert!(payload.len() >= STAGED_IMPORT_BYTES);
        let main_before = bob.text(&main).unwrap();
        let imported = bob.import(&payload).unwrap();
        let mut main_after = main_before.clone();
        let mut refs_after = String::new();
        for (id, deltas) in &imported.changes.texts {
            let target = if id == &main {
                &mut main_after
            } else {
                assert_eq!(id, &refs);
                &mut refs_after
            };
            let operation = delta_to_operation(target, deltas).unwrap();
            *target = applied(target, &operation);
        }
        assert_eq!(main_after, bob.text(&main).unwrap());
        assert_eq!(refs_after, big);
        assert!(imported.changes.tree);
        assert!(!imported.pending);
        let mut confirmed = since.clone();
        advance(&mut confirmed, &imported.arrived);
        assert!(confirmed.includes_vv(&alice.version()));
        alice
            .import(&bob.export_since(&alice.version()).unwrap())
            .unwrap();
        assert_eq!(bob.text(&main).unwrap(), alice.text(&main).unwrap());
        assert_eq!(bob.text(&refs).unwrap(), big);
        assert_eq!(bob.nodes().unwrap(), alice.nodes().unwrap());
        assert!(bob
            .text(&main)
            .unwrap()
            .starts_with("Bob: Hello Alice world"));
    }

    #[test]
    fn a_loaded_snapshot_has_the_same_files_and_text() {
        let (owner, joiner, main) = shared_pair();
        assert_eq!(joiner.text(&main).unwrap(), "Hello world\n");
        assert_eq!(joiner.nodes().unwrap(), owner.nodes().unwrap());
        assert_ne!(owner.doc.peer_id(), joiner.doc.peer_id());
    }

    #[test]
    fn imported_text_changes_become_utf16_operations() {
        let (mut owner, mut joiner, main) = shared_pair();
        let since = joiner.version();
        let mut typed = TextOperation::new();
        typed.retain(6).insert("😀 big ").retain(6);
        owner.apply_operation(&main, &typed).unwrap();
        let before = joiner.text(&main).unwrap();
        let imported = joiner.import(&owner.export_since(&since).unwrap()).unwrap();
        assert!(!imported.pending);
        assert!(!imported.changes.tree);
        let (id, deltas) = &imported.changes.texts[0];
        assert_eq!(id, &main);
        let operation = delta_to_operation(&before, deltas).unwrap();
        assert_eq!(operation, typed);
        assert_eq!(joiner.text(&main).unwrap(), "Hello 😀 big world\n");
    }

    #[test]
    fn concurrent_edits_converge_after_both_sides_import() {
        let (mut owner, mut joiner, main) = shared_pair();
        let owner_base = owner.version();
        let joiner_base = joiner.version();
        let mut left = TextOperation::new();
        left.insert("A").retain(12);
        owner.apply_operation(&main, &left).unwrap();
        let mut right = TextOperation::new();
        right.retain(11).insert("B").retain(1);
        joiner.apply_operation(&main, &right).unwrap();
        let from_owner = owner.export_since(&owner_base).unwrap();
        let from_joiner = joiner.export_since(&joiner_base).unwrap();
        owner.import(&from_joiner).unwrap();
        joiner.import(&from_owner).unwrap();
        assert_eq!(owner.text(&main).unwrap(), "AHello worldB\n");
        assert_eq!(joiner.text(&main).unwrap(), owner.text(&main).unwrap());
    }

    #[test]
    fn tree_changes_are_flagged_and_files_can_move_to_the_trash() {
        let (mut owner, mut joiner, main) = shared_pair();
        let since = joiner.version();
        let chapters = owner
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let intro = owner
            .add_node(Some(&chapters), "intro.tex", NodeKind::Text, None, "Intro")
            .unwrap();
        owner.rename(&main, "thesis.tex").unwrap();
        owner.trash(&intro).unwrap();
        let imported = joiner.import(&owner.export_since(&since).unwrap()).unwrap();
        assert!(imported.changes.tree);
        let nodes = joiner.nodes().unwrap();
        let renamed = nodes.iter().find(|node| node.id == main).unwrap();
        assert_eq!(renamed.name, "thesis.tex");
        let trashed = nodes.iter().find(|node| node.id == intro).unwrap();
        assert_eq!(trashed.parent, NodeParent::Trash);
    }

    #[test]
    fn setting_text_from_disk_reports_a_minimal_change() {
        let (mut owner, _joiner, main) = shared_pair();
        let changes = owner.set_text(&main, "Hello brave world\n").unwrap();
        let (id, deltas) = &changes.texts[0];
        assert_eq!(id, &main);
        let operation = delta_to_operation("Hello world\n", deltas).unwrap();
        assert_eq!(
            operation.apply("Hello world\n").unwrap(),
            "Hello brave world\n"
        );
        assert!(operation.components().len() <= 3);
        assert!(owner
            .set_text(&main, "Hello brave world\n")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn the_version_advances_only_for_peers_whose_changes_arrived() {
        let (mut owner, mut joiner, main) = shared_pair();
        let mut confirmed = joiner.version();
        let mut local = TextOperation::new();
        local.insert("x").retain(12);
        joiner.apply_operation(&main, &local).unwrap();
        assert!(joiner.has_changes_since(&confirmed));
        let since = owner.version();
        let mut remote = TextOperation::new();
        remote.retain(12).insert("y");
        owner.apply_operation(&main, &remote).unwrap();
        let imported = joiner.import(&owner.export_since(&since).unwrap()).unwrap();
        advance(&mut confirmed, &imported.arrived);
        assert!(joiner.has_changes_since(&confirmed));
        let pending = joiner.export_since(&confirmed).unwrap();
        let mut check = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        check.import(&pending).unwrap();
        assert_eq!(check.text(&main).unwrap(), joiner.text(&main).unwrap());
        let round_trip = decode_version(&encode_version(&confirmed)).unwrap();
        assert_eq!(round_trip, confirmed);
    }

    #[test]
    fn settings_travel_with_the_document_and_pending_work_is_counted() {
        let (mut owner, _joiner, main) = shared_pair();
        owner.set_meta("main_doc", "thesis.tex").unwrap();
        let confirmed = owner.version();
        let loaded = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        assert_eq!(loaded.meta("main_doc").as_deref(), Some("thesis.tex"));
        assert_eq!(loaded.meta("engine"), None);
        assert_eq!(owner.pending_since(&confirmed), 0);
        let mut typed = TextOperation::new();
        typed.insert("abc").retain(12);
        owner.apply_operation(&main, &typed).unwrap();
        assert_eq!(owner.pending_since(&confirmed), 3);
    }

    #[test]
    fn a_change_that_does_not_fit_is_refused() {
        let (mut owner, _joiner, main) = shared_pair();
        let mut wrong = TextOperation::new();
        wrong.retain(3);
        assert!(owner.apply_operation(&main, &wrong).is_err());
        assert!(ProjectDoc::load(b"not a document").is_err());
    }
}
