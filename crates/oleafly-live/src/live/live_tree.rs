use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use futures_util::future::BoxFuture;
use oleafly_collab::doc::FileNode;
use oleafly_collab::live::{DiskWork, LiveProject};
use oleafly_collab::materialize::Layout;
use oleafly_collab::CollabError;

use super::import::LocalImport;
use super::payloads::KeptFile;
use super::sync_hold::KeptEdit;
use super::LiveDisk;

pub struct Outgoing {
    pub work: DiskWork,
    pub next: Layout,
    pub texts: Vec<(String, String)>,
    pub crlf: BTreeSet<String>,
    pub kept: Vec<KeptFile>,
    pub copied: bool,
}

pub struct TreeRequest<'a> {
    pub import: LocalImport,
    pub edits: Vec<KeptEdit>,
    pub hold_dir: &'a Path,
    pub seen: &'a BTreeMap<String, String>,
}

pub enum TreeAnswer {
    Applied,
}

pub trait TreeRead {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError>;
    fn text(&self, id: &str) -> Result<Option<String>, CollabError>;
    fn crlf(&self, id: &str) -> bool;
}

pub trait LiveTree: TreeRead + Send + Sync {
    fn read_out(
        &self,
        previous: &mut Layout,
        hashes: &BTreeMap<String, String>,
    ) -> Result<Option<Outgoing>, CollabError>;
    fn can_edit(&self) -> bool;
    fn refused(&self, _import: &LocalImport) {}
    fn open(&self, ids: &[String]) -> BTreeSet<String>;
    fn mark_dirty(&self, ids: &[String]);
    fn noticed(&self, previous: &Layout, changed: &BTreeSet<String>, removed: &[String]);
    fn upload<'a>(
        &'a self,
        root: &'a Path,
        blobs: &'a [(String, String, u64)],
    ) -> BoxFuture<'a, BTreeSet<String>>;
    fn request_tree(
        &self,
        disk: &LiveDisk,
        change: TreeRequest<'_>,
    ) -> Result<TreeAnswer, CollabError>;
}

impl TreeRead for LiveProject {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        self.doc().nodes()
    }

    fn text(&self, id: &str) -> Result<Option<String>, CollabError> {
        self.doc().text(id).map(Some)
    }

    fn crlf(&self, id: &str) -> bool {
        self.doc().crlf(id)
    }
}
