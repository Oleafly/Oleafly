use automerge::transaction::{Transactable, Transaction};
use automerge::{
    ActorId, Automerge, AutomergeError, ChangeHash, LoadOptions, ObjId, ObjType, ReadDoc,
    TextEncoding, Value, ROOT,
};

use crate::engine::{
    decode_error, engine_error, import_error, Engine, EngineError, Imported, NewNode, NodeKind,
    NodeView, Parent,
};
use crate::tree;

pub struct AutomergeEngine {
    doc: Automerge,
}

fn node_key(id: &str) -> String {
    format!("n:{id}")
}

fn text_key(id: &str) -> String {
    format!("t:{id}")
}

fn actor(peer: u64) -> ActorId {
    ActorId::from(peer.to_be_bytes())
}

fn decode_heads(bytes: &[u8]) -> Result<Vec<ChangeHash>, EngineError> {
    let (chunks, remainder) = bytes.as_chunks::<32>();
    if !remainder.is_empty() {
        return Err(EngineError::Decode(format!(
            "a version of {} bytes is not a list of hashes",
            bytes.len()
        )));
    }
    Ok(chunks.iter().map(|chunk| ChangeHash(*chunk)).collect())
}

fn finish(
    transaction: Transaction<'_>,
    result: Result<(), AutomergeError>,
) -> Result<(), EngineError> {
    match result {
        Ok(()) => {
            let _ = transaction.commit();
            Ok(())
        }
        Err(error) => {
            let _ = transaction.rollback();
            Err(engine_error(error))
        }
    }
}

fn write_node(
    transaction: &mut Transaction<'_>,
    node: &NewNode<'_>,
    parent: &Parent,
    position: &str,
) -> Result<(), AutomergeError> {
    let object = transaction.put_object(ROOT, node_key(node.id), ObjType::Map)?;
    transaction.put(&object, "parent", parent.encode())?;
    transaction.put(&object, "name", node.name)?;
    transaction.put(&object, "kind", node.kind.as_str())?;
    transaction.put(&object, "blob", node.blob_hash.unwrap_or(""))?;
    transaction.put(&object, "pos", position)?;
    if node.kind == NodeKind::Text {
        let text = transaction.put_object(ROOT, text_key(node.id), ObjType::Text)?;
        if !node.text.is_empty() {
            transaction.splice_text(&text, 0, 0, node.text)?;
        }
    }
    Ok(())
}

fn write_parent(
    transaction: &mut Transaction<'_>,
    object: &ObjId,
    parent: &Parent,
    position: &str,
) -> Result<(), AutomergeError> {
    transaction.put(object, "parent", parent.encode())?;
    transaction.put(object, "pos", position)
}

impl AutomergeEngine {
    fn object(&self, key: &str) -> Option<ObjId> {
        match self.doc.get(ROOT, key) {
            Ok(Some((Value::Object(_), object))) => Some(object),
            _ => None,
        }
    }

    fn node(&self, id: &str) -> Result<ObjId, EngineError> {
        self.object(&node_key(id))
            .ok_or_else(|| EngineError::UnknownNode(id.to_owned()))
    }

    fn text_object(&self, id: &str) -> Result<ObjId, EngineError> {
        self.node(id)?;
        self.object(&text_key(id))
            .ok_or_else(|| EngineError::NotText(id.to_owned()))
    }

    fn field(&self, object: &ObjId, key: &str) -> Option<String> {
        match self.doc.get(object, key) {
            Ok(Some((value, _))) => value.into_string().ok(),
            _ => None,
        }
    }

    fn views(&self) -> Vec<NodeView> {
        let mut views = Vec::new();
        for key in self.doc.keys(ROOT) {
            let Some(id) = key.strip_prefix("n:") else {
                continue;
            };
            let Some(object) = self.object(&key) else {
                continue;
            };
            views.push(NodeView {
                id: id.to_owned(),
                parent: Parent::decode(&self.field(&object, "parent").unwrap_or_default()),
                name: self.field(&object, "name").unwrap_or_default(),
                kind: self
                    .field(&object, "kind")
                    .and_then(|kind| NodeKind::parse(&kind))
                    .unwrap_or(NodeKind::Text),
                blob_hash: self.field(&object, "blob").filter(|hash| !hash.is_empty()),
                position: self.field(&object, "pos").unwrap_or_default(),
            });
        }
        views
    }

    fn set_parent(&mut self, id: &str, parent: &Parent) -> Result<(), EngineError> {
        let object = self.node(id)?;
        let views = self.views();
        if let Parent::Node(target) = parent {
            self.node(target)?;
            if tree::would_cycle(&views, id, target) {
                return Err(EngineError::Cycle(id.to_owned()));
            }
        }
        let position = tree::next_position(&views, parent);
        let mut transaction = self.doc.transaction();
        let result = write_parent(&mut transaction, &object, parent, &position);
        finish(transaction, result)
    }
}

impl Engine for AutomergeEngine {
    const NAME: &'static str = "automerge";

    fn new(peer: u64) -> Result<Self, EngineError> {
        Ok(AutomergeEngine {
            doc: Automerge::new_with_encoding(TextEncoding::Utf16CodeUnit).with_actor(actor(peer)),
        })
    }

    fn load(bytes: &[u8], peer: u64) -> Result<Self, EngineError> {
        let options = LoadOptions::new().text_encoding(TextEncoding::Utf16CodeUnit);
        let doc = Automerge::load_with_options(bytes, options).map_err(decode_error)?;
        Ok(AutomergeEngine {
            doc: doc.with_actor(actor(peer)),
        })
    }

    fn create_node(&mut self, node: &NewNode<'_>) -> Result<(), EngineError> {
        if self.object(&node_key(node.id)).is_some() {
            return Err(EngineError::DuplicateNode(node.id.to_owned()));
        }
        if let Some(parent) = node.parent {
            self.node(parent)?;
        }
        let parent = Parent::from_option(node.parent);
        let position = tree::next_position(&self.views(), &parent);
        let mut transaction = self.doc.transaction();
        let result = write_node(&mut transaction, node, &parent, &position);
        finish(transaction, result)
    }

    fn rename(&mut self, id: &str, name: &str) -> Result<(), EngineError> {
        let object = self.node(id)?;
        let mut transaction = self.doc.transaction();
        let result = transaction.put(&object, "name", name);
        finish(transaction, result)
    }

    fn move_node(&mut self, id: &str, parent: Option<&str>) -> Result<(), EngineError> {
        self.set_parent(id, &Parent::from_option(parent))
    }

    fn trash(&mut self, id: &str) -> Result<(), EngineError> {
        self.set_parent(id, &Parent::Trash)
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
        let object = self.text_object(id)?;
        let len = self.doc.length(&object);
        if pos + delete > len {
            return Err(EngineError::OutOfRange { pos, delete, len });
        }
        let mut transaction = self.doc.transaction();
        let result = transaction.splice_text(&object, pos, delete as isize, insert);
        finish(transaction, result)
    }

    fn text(&self, id: &str) -> Result<String, EngineError> {
        let object = self.text_object(id)?;
        self.doc.text(&object).map_err(engine_error)
    }

    fn nodes(&self) -> Result<Vec<NodeView>, EngineError> {
        Ok(self.views())
    }

    fn version(&self) -> Vec<u8> {
        let mut heads = self.doc.get_heads();
        heads.sort();
        heads.iter().flat_map(|hash| hash.0).collect()
    }

    fn export_since(&self, version: &[u8]) -> Result<Vec<u8>, EngineError> {
        let heads = decode_heads(version)?;
        Ok(self.doc.save_after(&heads))
    }

    fn import(&mut self, bytes: &[u8]) -> Result<Imported, EngineError> {
        self.doc.load_incremental(bytes).map_err(import_error)?;
        Ok(Imported {
            pending: !self.doc.get_missing_deps(&[]).is_empty(),
        })
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        Ok(self.doc.save())
    }

    fn compact(&self) -> Result<Vec<u8>, EngineError> {
        Ok(self.doc.save())
    }

    fn save(&self) -> Result<Vec<u8>, EngineError> {
        Ok(self.doc.save())
    }
}
