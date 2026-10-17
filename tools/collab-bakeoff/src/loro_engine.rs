use std::collections::HashMap;

use loro::{
    ExportMode, LoroDoc, LoroMap, LoroTree, LoroValue, TreeID, TreeParentId, ValueOrContainer,
    VersionVector,
};

use crate::engine::{
    decode_error, engine_error, export_error, import_error, Engine, EngineError, Imported, NewNode,
    NodeKind, NodeView, Parent, TRASH_KEY,
};

const TREE: &str = "tree";

pub struct LoroEngine {
    doc: LoroDoc,
    tree: LoroTree,
    ids: HashMap<String, TreeID>,
    trash: Option<TreeID>,
}

fn text_container(id: &str) -> String {
    format!("text:{id}")
}

fn meta_string(meta: &LoroMap, key: &str) -> Option<String> {
    match meta.get(key) {
        Some(ValueOrContainer::Value(LoroValue::String(value))) => Some(value.as_str().to_owned()),
        _ => None,
    }
}

impl LoroEngine {
    fn attach(doc: LoroDoc) -> Result<LoroEngine, EngineError> {
        let tree = doc.get_tree(TREE);
        tree.enable_fractional_index(0);
        let mut engine = LoroEngine {
            doc,
            tree,
            ids: HashMap::new(),
            trash: None,
        };
        engine.reindex()?;
        Ok(engine)
    }

    fn reindex(&mut self) -> Result<(), EngineError> {
        let mut ids = HashMap::new();
        let mut trash: Option<TreeID> = None;
        for node in self.tree.get_nodes(false) {
            let meta = self.tree.get_meta(node.id).map_err(engine_error)?;
            match meta_string(&meta, "id") {
                Some(id) if id == TRASH_KEY => {
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

    fn tree_id(&self, id: &str) -> Result<TreeID, EngineError> {
        self.ids
            .get(id)
            .copied()
            .ok_or_else(|| EngineError::UnknownNode(id.to_owned()))
    }

    fn parent_of(&self, parent: Option<&str>) -> Result<TreeParentId, EngineError> {
        match parent {
            None => Ok(TreeParentId::Root),
            Some(id) => Ok(TreeParentId::Node(self.tree_id(id)?)),
        }
    }

    fn trash_node(&self) -> Result<TreeID, EngineError> {
        self.trash
            .ok_or_else(|| EngineError::Decode("the document has no trash node".to_owned()))
    }

    fn reparent(&mut self, id: &str, parent: TreeParentId) -> Result<(), EngineError> {
        let node = self.tree_id(id)?;
        self.tree.mov(node, parent).map_err(engine_error)?;
        self.doc.commit();
        Ok(())
    }
}

impl Engine for LoroEngine {
    const NAME: &'static str = "loro";

    fn new(peer: u64) -> Result<Self, EngineError> {
        let doc = LoroDoc::new();
        doc.set_peer_id(peer).map_err(engine_error)?;
        let tree = doc.get_tree(TREE);
        tree.enable_fractional_index(0);
        let trash = tree.create(TreeParentId::Root).map_err(engine_error)?;
        let meta = tree.get_meta(trash).map_err(engine_error)?;
        meta.insert("id", TRASH_KEY).map_err(engine_error)?;
        meta.insert("name", TRASH_KEY).map_err(engine_error)?;
        meta.insert("kind", NodeKind::Dir.as_str())
            .map_err(engine_error)?;
        doc.commit();
        Ok(LoroEngine {
            doc,
            tree,
            ids: HashMap::new(),
            trash: Some(trash),
        })
    }

    fn load(bytes: &[u8], peer: u64) -> Result<Self, EngineError> {
        let doc = LoroDoc::new();
        doc.set_peer_id(peer).map_err(engine_error)?;
        doc.import(bytes).map_err(decode_error)?;
        let engine = LoroEngine::attach(doc)?;
        engine.trash_node()?;
        Ok(engine)
    }

    fn create_node(&mut self, node: &NewNode<'_>) -> Result<(), EngineError> {
        if self.ids.contains_key(node.id) {
            return Err(EngineError::DuplicateNode(node.id.to_owned()));
        }
        let parent = self.parent_of(node.parent)?;
        let created = self.tree.create(parent).map_err(engine_error)?;
        let meta = self.tree.get_meta(created).map_err(engine_error)?;
        meta.insert("id", node.id).map_err(engine_error)?;
        meta.insert("name", node.name).map_err(engine_error)?;
        meta.insert("kind", node.kind.as_str())
            .map_err(engine_error)?;
        if let Some(hash) = node.blob_hash {
            meta.insert("blob", hash).map_err(engine_error)?;
        }
        if node.kind == NodeKind::Text && !node.text.is_empty() {
            self.doc
                .get_text(text_container(node.id))
                .insert_utf16(0, node.text)
                .map_err(engine_error)?;
        }
        self.doc.commit();
        self.ids.insert(node.id.to_owned(), created);
        Ok(())
    }

    fn rename(&mut self, id: &str, name: &str) -> Result<(), EngineError> {
        let node = self.tree_id(id)?;
        self.tree
            .get_meta(node)
            .map_err(engine_error)?
            .insert("name", name)
            .map_err(engine_error)?;
        self.doc.commit();
        Ok(())
    }

    fn move_node(&mut self, id: &str, parent: Option<&str>) -> Result<(), EngineError> {
        let parent = self.parent_of(parent)?;
        self.reparent(id, parent)
    }

    fn trash(&mut self, id: &str) -> Result<(), EngineError> {
        let trash = self.trash_node()?;
        self.reparent(id, TreeParentId::Node(trash))
    }

    fn restore(&mut self, id: &str, parent: Option<&str>) -> Result<(), EngineError> {
        self.move_node(id, parent)
    }

    fn splice_utf16(
        &mut self,
        id: &str,
        pos: usize,
        delete: usize,
        insert: &str,
    ) -> Result<(), EngineError> {
        self.tree_id(id)?;
        let text = self.doc.get_text(text_container(id));
        let len = text.len_utf16();
        if pos + delete > len {
            return Err(EngineError::OutOfRange { pos, delete, len });
        }
        text.splice_utf16(pos, delete, insert)
            .map_err(engine_error)?;
        self.doc.commit();
        Ok(())
    }

    fn text(&self, id: &str) -> Result<String, EngineError> {
        self.tree_id(id)?;
        Ok(self.doc.get_text(text_container(id)).to_string())
    }

    fn nodes(&self) -> Result<Vec<NodeView>, EngineError> {
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
                TreeParentId::Root => Parent::Root,
                TreeParentId::Node(parent) if Some(parent) == self.trash => Parent::Trash,
                TreeParentId::Node(parent) => match by_tree.get(&parent) {
                    Some(parent_id) => Parent::Node((*parent_id).to_owned()),
                    None => Parent::Node(parent.to_string()),
                },
                _ => continue,
            };
            let meta = self.tree.get_meta(node.id).map_err(engine_error)?;
            views.push(NodeView {
                id: (*id).to_owned(),
                parent,
                name: meta_string(&meta, "name").unwrap_or_default(),
                kind: meta_string(&meta, "kind")
                    .and_then(|kind| NodeKind::parse(&kind))
                    .unwrap_or(NodeKind::Text),
                blob_hash: meta_string(&meta, "blob"),
                position: node.fractional_index.to_string(),
            });
        }
        Ok(views)
    }

    fn version(&self) -> Vec<u8> {
        self.doc.oplog_vv().encode()
    }

    fn export_since(&self, version: &[u8]) -> Result<Vec<u8>, EngineError> {
        let from = if version.is_empty() {
            VersionVector::new()
        } else {
            VersionVector::decode(version).map_err(decode_error)?
        };
        self.doc
            .export(ExportMode::updates(&from))
            .map_err(export_error)
    }

    fn import(&mut self, bytes: &[u8]) -> Result<Imported, EngineError> {
        let status = self.doc.import(bytes).map_err(import_error)?;
        self.reindex()?;
        Ok(Imported {
            pending: status.pending.is_some(),
        })
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        self.doc
            .export(ExportMode::snapshot())
            .map_err(export_error)
    }

    fn compact(&self) -> Result<Vec<u8>, EngineError> {
        let frontiers = self.doc.oplog_frontiers();
        self.doc
            .export(ExportMode::shallow_snapshot(&frontiers))
            .map_err(export_error)
    }

    fn save(&self) -> Result<Vec<u8>, EngineError> {
        self.snapshot()
    }
}
