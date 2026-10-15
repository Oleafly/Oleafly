use std::fmt;

use crate::tree::{self, Materialized};

pub const TRASH_KEY: &str = "~trash";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum NodeKind {
    Dir,
    Text,
    Blob,
}

impl NodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::Dir => "dir",
            NodeKind::Text => "text",
            NodeKind::Blob => "blob",
        }
    }

    pub fn parse(value: &str) -> Option<NodeKind> {
        match value {
            "dir" => Some(NodeKind::Dir),
            "text" => Some(NodeKind::Text),
            "blob" => Some(NodeKind::Blob),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Parent {
    Root,
    Trash,
    Node(String),
}

impl Parent {
    pub fn from_option(parent: Option<&str>) -> Parent {
        match parent {
            None => Parent::Root,
            Some(id) => Parent::Node(id.to_owned()),
        }
    }

    pub fn encode(&self) -> String {
        match self {
            Parent::Root => String::new(),
            Parent::Trash => TRASH_KEY.to_owned(),
            Parent::Node(id) => id.clone(),
        }
    }

    pub fn decode(value: &str) -> Parent {
        match value {
            "" => Parent::Root,
            TRASH_KEY => Parent::Trash,
            other => Parent::Node(other.to_owned()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NewNode<'a> {
    pub id: &'a str,
    pub parent: Option<&'a str>,
    pub name: &'a str,
    pub kind: NodeKind,
    pub blob_hash: Option<&'a str>,
    pub text: &'a str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NodeView {
    pub id: String,
    pub parent: Parent,
    pub name: String,
    pub kind: NodeKind,
    pub blob_hash: Option<String>,
    pub position: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Imported {
    pub pending: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EngineError {
    UnknownNode(String),
    DuplicateNode(String),
    NotText(String),
    OutOfRange {
        pos: usize,
        delete: usize,
        len: usize,
    },
    Cycle(String),
    Decode(String),
    Import(String),
    Export(String),
    Other(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::UnknownNode(id) => write!(formatter, "unknown node {id}"),
            EngineError::DuplicateNode(id) => write!(formatter, "node {id} already exists"),
            EngineError::NotText(id) => write!(formatter, "node {id} has no text"),
            EngineError::OutOfRange { pos, delete, len } => {
                write!(
                    formatter,
                    "splice at {pos} deleting {delete} passes length {len}"
                )
            }
            EngineError::Cycle(id) => write!(formatter, "moving {id} would create a cycle"),
            EngineError::Decode(message) => write!(formatter, "decode: {message}"),
            EngineError::Import(message) => write!(formatter, "import: {message}"),
            EngineError::Export(message) => write!(formatter, "export: {message}"),
            EngineError::Other(message) => write!(formatter, "engine: {message}"),
        }
    }
}

impl std::error::Error for EngineError {}

pub fn engine_error<T: fmt::Debug>(error: T) -> EngineError {
    EngineError::Other(format!("{error:?}"))
}

pub fn decode_error<T: fmt::Debug>(error: T) -> EngineError {
    EngineError::Decode(format!("{error:?}"))
}

pub fn import_error<T: fmt::Debug>(error: T) -> EngineError {
    EngineError::Import(format!("{error:?}"))
}

pub fn export_error<T: fmt::Debug>(error: T) -> EngineError {
    EngineError::Export(format!("{error:?}"))
}

pub trait Engine: Sized {
    const NAME: &'static str;

    fn new(peer: u64) -> Result<Self, EngineError>;
    fn load(bytes: &[u8], peer: u64) -> Result<Self, EngineError>;
    fn create_node(&mut self, node: &NewNode<'_>) -> Result<(), EngineError>;
    fn rename(&mut self, id: &str, name: &str) -> Result<(), EngineError>;
    fn move_node(&mut self, id: &str, parent: Option<&str>) -> Result<(), EngineError>;
    fn trash(&mut self, id: &str) -> Result<(), EngineError>;
    fn restore(&mut self, id: &str, parent: Option<&str>) -> Result<(), EngineError>;
    fn splice_utf16(
        &mut self,
        id: &str,
        pos: usize,
        delete: usize,
        insert: &str,
    ) -> Result<(), EngineError>;
    fn text(&self, id: &str) -> Result<String, EngineError>;
    fn nodes(&self) -> Result<Vec<NodeView>, EngineError>;
    fn version(&self) -> Vec<u8>;
    fn export_since(&self, version: &[u8]) -> Result<Vec<u8>, EngineError>;
    fn import(&mut self, bytes: &[u8]) -> Result<Imported, EngineError>;
    fn snapshot(&self) -> Result<Vec<u8>, EngineError>;
    fn compact(&self) -> Result<Vec<u8>, EngineError>;
    fn save(&self) -> Result<Vec<u8>, EngineError>;

    fn materialize(&self) -> Result<Materialized, EngineError> {
        let nodes = self.nodes()?;
        tree::materialize(&nodes, &|id: &str| self.text(id))
    }
}
