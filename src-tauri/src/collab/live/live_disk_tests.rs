use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use oleafly_collab::doc::{FileNode, NodeKind, NodeParent};
use oleafly_collab::live::DiskWork;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::CollabError;

use super::live_disk::Mirrored;
use super::live_tree::{LiveTree, Mirror, TreeAnswer, TreeRead, TreeRequest};
use super::session::{guard, Upkeep, WriterSignal};
use super::{
    LiveDisk, LiveHost, MergedPayload, NewDevicePayload, PresenceLeftPayload, PresencePayload,
    RolePayload, StatusPayload,
};
use crate::collab::disk::DiskState;
use crate::folder_watch::FolderChange;

#[derive(Default)]
struct Told(Mutex<Vec<FolderChange>>);

impl LiveHost for Told {
    fn status(&self, _: StatusPayload) {}
    fn role(&self, _: RolePayload) {}
    fn merged(&self, _: MergedPayload) {}
    fn presence(&self, _: PresencePayload) {}
    fn presence_left(&self, _: PresenceLeftPayload) {}
    fn folder_changed(&self, change: FolderChange) {
        guard(&self.0).push(change);
    }
    fn new_device(&self, _: NewDevicePayload) {}
}

#[derive(Default)]
struct Room {
    nodes: Vec<FileNode>,
    texts: BTreeMap<String, String>,
    crlf: BTreeSet<String>,
    work: DiskWork,
    received: Vec<(String, String)>,
}

impl TreeRead for Room {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        Ok(self.nodes.clone())
    }

    fn text(&self, id: &str) -> Result<String, CollabError> {
        self.texts
            .get(id)
            .cloned()
            .ok_or_else(|| CollabError::Corrupt(format!("no text {id}")))
    }

    fn crlf(&self, id: &str) -> bool {
        self.crlf.contains(id)
    }
}

#[derive(Default)]
struct FakeTree(Mutex<Room>);

impl FakeTree {
    fn add(&self, id: &str, parent: Option<&str>, name: &str, text: Option<&str>) {
        let mut room = guard(&self.0);
        let position = format!("{:04}", room.nodes.len());
        room.nodes.push(FileNode {
            id: id.to_owned(),
            parent: parent.map_or(NodeParent::Root, |parent| {
                NodeParent::Node(parent.to_owned())
            }),
            name: name.to_owned(),
            kind: if text.is_some() {
                NodeKind::Text
            } else {
                NodeKind::Dir
            },
            blob: None,
            position,
            author_name: None,
        });
        if let Some(text) = text {
            room.texts.insert(id.to_owned(), text.to_owned());
            room.work.texts.insert(id.to_owned());
        }
        room.work.tree = true;
    }

    fn crlf(&self, id: &str) {
        guard(&self.0).crlf.insert(id.to_owned());
    }

    fn text_of(&self, id: &str) -> String {
        guard(&self.0).texts[id].clone()
    }

    fn received(&self) -> Vec<(String, String)> {
        guard(&self.0).received.clone()
    }
}

impl TreeRead for FakeTree {
    fn nodes(&self) -> Result<Vec<FileNode>, CollabError> {
        guard(&self.0).nodes()
    }

    fn text(&self, id: &str) -> Result<String, CollabError> {
        TreeRead::text(&*guard(&self.0), id)
    }

    fn crlf(&self, id: &str) -> bool {
        TreeRead::crlf(&*guard(&self.0), id)
    }
}

impl LiveTree for FakeTree {
    fn read_out(
        &self,
        previous: &mut Layout,
        _hashes: &BTreeMap<String, String>,
    ) -> Result<Option<Mirror>, CollabError> {
        let mut room = guard(&self.0);
        let work = std::mem::take(&mut room.work);
        if work.is_empty() {
            return Ok(None);
        }
        let drawn = LiveDisk::draw(&*room, &work, previous)?;
        Ok(Some(Mirror {
            work,
            next: drawn.next,
            texts: drawn.texts,
            crlf: drawn.crlf,
            kept: Vec::new(),
            copied: false,
        }))
    }

    fn can_edit(&self) -> bool {
        true
    }

    fn open(&self, _ids: &[String]) -> BTreeSet<String> {
        BTreeSet::new()
    }

    fn mark_dirty(&self, ids: &[String]) {
        guard(&self.0).work.texts.extend(ids.iter().cloned());
    }

    fn noticed(&self, _: &Layout, _: &BTreeSet<String>, _: &[String]) {}

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
        let mut room = guard(&self.0);
        let layout = materialize::layout(&room.nodes);
        let mut state = guard(&disk.disk);
        let mut bases = guard(&disk.bases);
        for (path, text, hash) in change.import.texts {
            let Some(id) = layout
                .iter()
                .find(|(_, placed)| placed.path == path)
                .map(|(id, _)| id.clone())
            else {
                continue;
            };
            room.texts.insert(id, text.clone());
            bases.record(&path, &text);
            state.hashes.insert(path.clone(), hash);
            room.received.push((path, text));
        }
        for (path, hash) in change.import.restamped {
            state.hashes.insert(path, hash);
        }
        Ok(TreeAnswer::Applied)
    }
}

struct Mirrorer {
    disk: LiveDisk,
    host: Arc<Told>,
    hold: PathBuf,
    _signals: tokio::sync::mpsc::UnboundedReceiver<WriterSignal>,
    _dir: tempfile::TempDir,
}

impl Mirrorer {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        let hold = dir.path().join("collab");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&hold).unwrap();
        let host = Arc::new(Told::default());
        let (writer, signals) = tokio::sync::mpsc::unbounded_channel();
        let disk = LiveDisk {
            project_id: "fake-project".to_owned(),
            root,
            disk_file: hold.join("materializer-index.json"),
            disk: Mutex::new(DiskState::default()),
            bases: Mutex::new(Default::default()),
            host: Arc::clone(&host) as Arc<dyn LiveHost>,
            writer,
            upkeep: Upkeep::default(),
        };
        Self {
            disk,
            host,
            hold,
            _signals: signals,
            _dir: dir,
        }
    }

    fn write_out(&self, tree: &FakeTree) -> Option<Mirrored> {
        let (mut previous, hashes, owed) = self.disk.snapshot();
        let mirror = tree.read_out(&mut previous, &hashes).unwrap()?;
        Some(
            self.disk
                .mirror(tree, &self.hold, &previous, &owed, mirror, true)
                .unwrap(),
        )
    }

    fn import(&self, tree: &FakeTree, only: Option<&[&str]>) {
        let only = only.map(|paths| paths.iter().map(|path| (*path).to_owned()).collect());
        tauri::async_runtime::block_on(self.disk.import(tree, &self.hold, only)).unwrap();
    }

    fn read(&self, path: &str) -> Vec<u8> {
        std::fs::read(self.disk.root.join(path)).unwrap()
    }

    fn edit(&self, path: &str, text: &str) {
        std::fs::write(self.disk.root.join(path), text).unwrap();
    }

    fn told_paths(&self) -> BTreeSet<String> {
        guard(&self.host.0)
            .iter()
            .flat_map(|change| change.paths.iter().cloned())
            .collect()
    }
}

#[test]
fn a_fake_live_tree_gets_its_texts_written_and_its_outside_edits_back() {
    let tree = FakeTree::default();
    tree.add("main", None, "main.tex", Some("\\input{sections/intro}\n"));
    tree.add("sections", None, "sections", None);
    tree.add("intro", Some("sections"), "intro.tex", Some("Hello\n"));
    let mirror = Mirrorer::new();

    let wrote = mirror.write_out(&tree).unwrap();

    assert!(wrote.conflicts.is_empty());
    assert_eq!(mirror.read("main.tex"), b"\\input{sections/intro}\n");
    assert_eq!(mirror.read("sections/intro.tex"), b"Hello\n");
    assert_eq!(
        mirror.told_paths(),
        BTreeSet::from(["main.tex", "sections", "sections/intro.tex"].map(str::to_owned))
    );
    assert!(mirror.write_out(&tree).is_none());

    mirror.edit("sections/intro.tex", "Hello, world\n");
    mirror.import(&tree, Some(&["sections/intro.tex"]));

    assert_eq!(
        tree.received(),
        vec![("sections/intro.tex".to_owned(), "Hello, world\n".to_owned())]
    );
    assert_eq!(tree.text_of("intro"), "Hello, world\n");

    mirror.import(&tree, None);

    assert_eq!(tree.received().len(), 1);
}

#[test]
fn the_mirror_keeps_crlf_and_suppresses_its_own_echo() {
    let tree = FakeTree::default();
    tree.add("main", None, "main.tex", Some("one\ntwo\n"));
    tree.crlf("main");
    let mirror = Mirrorer::new();

    mirror.write_out(&tree).unwrap();

    assert_eq!(mirror.read("main.tex"), b"one\r\ntwo\r\n");

    mirror.import(&tree, Some(&["main.tex"]));
    mirror.import(&tree, None);

    assert!(tree.received().is_empty());
    assert_eq!(tree.text_of("main"), "one\ntwo\n");
}
