use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{
    ClientID, Doc, GetString, In, Map, MapPrelim, MapRef, OffsetKind, Options, ReadTxn,
    StateVector, Text, TextPrelim, TextRef, Transact, Update,
};

use crate::engine::{
    decode_error, import_error, Engine, EngineError, Imported, NewNode, NodeKind, NodeView, Parent,
};
use crate::tree;

pub struct YrsEngine {
    doc: Doc,
    nodes: MapRef,
    texts: MapRef,
}

fn read_string<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    map.get(txn, key)
        .and_then(|value| value.cast::<String>().ok())
}

impl YrsEngine {
    fn node<T: ReadTxn>(&self, txn: &T, id: &str) -> Result<MapRef, EngineError> {
        self.nodes
            .get(txn, id)
            .and_then(|value| value.cast::<MapRef>().ok())
            .ok_or_else(|| EngineError::UnknownNode(id.to_owned()))
    }

    fn text_ref<T: ReadTxn>(&self, txn: &T, id: &str) -> Result<TextRef, EngineError> {
        self.node(txn, id)?;
        self.texts
            .get(txn, id)
            .and_then(|value| value.cast::<TextRef>().ok())
            .ok_or_else(|| EngineError::NotText(id.to_owned()))
    }

    fn views<T: ReadTxn>(&self, txn: &T) -> Vec<NodeView> {
        let mut views = Vec::new();
        for (id, value) in self.nodes.iter(txn) {
            let Ok(node) = value.cast::<MapRef>() else {
                continue;
            };
            views.push(NodeView {
                id: id.to_owned(),
                parent: Parent::decode(&read_string(&node, txn, "parent").unwrap_or_default()),
                name: read_string(&node, txn, "name").unwrap_or_default(),
                kind: read_string(&node, txn, "kind")
                    .and_then(|kind| NodeKind::parse(&kind))
                    .unwrap_or(NodeKind::Text),
                blob_hash: read_string(&node, txn, "blob").filter(|hash| !hash.is_empty()),
                position: read_string(&node, txn, "pos").unwrap_or_default(),
            });
        }
        views
    }

    fn set_parent(&self, id: &str, parent: &Parent) -> Result<(), EngineError> {
        let mut txn = self.doc.transact_mut();
        let node = self.node(&txn, id)?;
        let views = self.views(&txn);
        if let Parent::Node(target) = parent {
            self.node(&txn, target)?;
            if tree::would_cycle(&views, id, target) {
                return Err(EngineError::Cycle(id.to_owned()));
            }
        }
        let position = tree::next_position(&views, parent);
        node.insert(&mut txn, "parent", parent.encode());
        node.insert(&mut txn, "pos", position);
        Ok(())
    }
}

impl Engine for YrsEngine {
    const NAME: &'static str = "yrs";

    fn new(peer: u64) -> Result<Self, EngineError> {
        let mut options = Options::with_client_id(ClientID::new(peer));
        options.offset_kind = OffsetKind::Utf16;
        let doc = Doc::with_options(options);
        let nodes = doc.get_or_insert_map("nodes");
        let texts = doc.get_or_insert_map("texts");
        Ok(YrsEngine { doc, nodes, texts })
    }

    fn load(bytes: &[u8], peer: u64) -> Result<Self, EngineError> {
        let mut engine = YrsEngine::new(peer)?;
        engine
            .import(bytes)
            .map_err(|error| EngineError::Decode(error.to_string()))?;
        Ok(engine)
    }

    fn create_node(&mut self, node: &NewNode<'_>) -> Result<(), EngineError> {
        let mut txn = self.doc.transact_mut();
        if self.nodes.contains_key(&txn, node.id) {
            return Err(EngineError::DuplicateNode(node.id.to_owned()));
        }
        if let Some(parent) = node.parent {
            self.node(&txn, parent)?;
        }
        let parent = Parent::from_option(node.parent);
        let position = tree::next_position(&self.views(&txn), &parent);
        let fields: [(&str, In); 5] = [
            ("parent", In::from(parent.encode())),
            ("name", In::from(node.name)),
            ("kind", In::from(node.kind.as_str())),
            ("blob", In::from(node.blob_hash.unwrap_or(""))),
            ("pos", In::from(position)),
        ];
        self.nodes
            .insert(&mut txn, node.id, MapPrelim::from(fields));
        if node.kind == NodeKind::Text {
            self.texts
                .insert(&mut txn, node.id, TextPrelim::new(node.text));
        }
        Ok(())
    }

    fn rename(&mut self, id: &str, name: &str) -> Result<(), EngineError> {
        let mut txn = self.doc.transact_mut();
        let node = self.node(&txn, id)?;
        node.insert(&mut txn, "name", name);
        Ok(())
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
        let mut txn = self.doc.transact_mut();
        let text = self.text_ref(&txn, id)?;
        let len = Text::len(&text, &txn) as usize;
        if pos + delete > len {
            return Err(EngineError::OutOfRange { pos, delete, len });
        }
        if delete > 0 {
            text.remove_range(&mut txn, pos as u32, delete as u32);
        }
        if !insert.is_empty() {
            text.insert(&mut txn, pos as u32, insert);
        }
        Ok(())
    }

    fn text(&self, id: &str) -> Result<String, EngineError> {
        let txn = self.doc.transact();
        let text = self.text_ref(&txn, id)?;
        Ok(text.get_string(&txn))
    }

    fn nodes(&self) -> Result<Vec<NodeView>, EngineError> {
        let txn = self.doc.transact();
        Ok(self.views(&txn))
    }

    fn version(&self) -> Vec<u8> {
        self.doc.transact().state_vector().encode_v1()
    }

    fn export_since(&self, version: &[u8]) -> Result<Vec<u8>, EngineError> {
        let state = if version.is_empty() {
            StateVector::default()
        } else {
            StateVector::decode_v1(version).map_err(decode_error)?
        };
        Ok(self.doc.transact().encode_diff_v1(&state))
    }

    fn import(&mut self, bytes: &[u8]) -> Result<Imported, EngineError> {
        let update = Update::decode_v1(bytes).map_err(decode_error)?;
        let mut txn = self.doc.transact_mut();
        txn.apply_update(update).map_err(import_error)?;
        Ok(Imported {
            pending: txn.has_missing_updates(),
        })
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        Ok(self
            .doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default()))
    }

    fn compact(&self) -> Result<Vec<u8>, EngineError> {
        self.snapshot()
    }

    fn save(&self) -> Result<Vec<u8>, EngineError> {
        self.snapshot()
    }
}
