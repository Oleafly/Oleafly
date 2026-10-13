use std::collections::{BTreeMap, BTreeSet};

use oleafly_collab::doc::{FileNode, NodeKind, NodeParent};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout, Placed};
use oleafly_collab::CollabError;
use serde::Serialize;

use super::{name_of, parent_of};

pub const LIVE_KEPT_EVENT: &str = "collab-live-kept";
const SHORT_HASH: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeptKind {
    Replaced,
    Added,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptFile {
    pub id: String,
    pub path: String,
    pub copy: String,
    pub kind: KeptKind,
    pub by: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptPayload {
    pub project_id: String,
    pub files: Vec<KeptFile>,
}

pub(super) struct LostFigure {
    original: String,
    copy: String,
    by: Option<String>,
}

fn tagged(name: &str, tag: &str) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({tag}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({tag})"),
    }
}

fn copy_name(name: &str, author: Option<&str>, hash: &str, taken: &mut BTreeSet<String>) -> String {
    let credited = author.and_then(|author| {
        materialize::credited_name(name, author, hash, |named| {
            taken.insert(named.to_lowercase())
        })
    });
    credited.unwrap_or_else(|| {
        let named = tagged(name, &hash[..hash.len().min(SHORT_HASH)]);
        taken.insert(named.to_lowercase());
        named
    })
}

pub(super) fn keep_lost_figures(
    live: &mut LiveProject,
    previous: &mut Layout,
    hashes: &BTreeMap<String, String>,
) -> Result<Vec<LostFigure>, CollabError> {
    let Some(me) = live.doc().author_key().map(str::to_owned) else {
        return Ok(Vec::new());
    };
    if !live.can_edit() {
        return Ok(Vec::new());
    }
    let nodes = live.doc().nodes()?;
    let now = materialize::layout(&nodes);
    let mut lost = Vec::new();
    let mut taken: BTreeMap<NodeParent, BTreeSet<String>> = BTreeMap::new();
    for node in nodes.iter().filter(|node| node.kind == NodeKind::Blob) {
        let (Some(before), Some(placed)) = (previous.get(&node.id), now.get(&node.id)) else {
            continue;
        };
        let (Some(ours), Some(theirs)) = (before.blob.clone(), placed.blob.clone()) else {
            continue;
        };
        let doc = live.doc();
        if ours == theirs
            || doc.blob_setter(&node.id, &ours).as_deref() != Some(me.as_str())
            || doc.blob_was(&node.id).as_deref() == Some(ours.as_str())
        {
            continue;
        }
        let by = doc.blob_setter(&node.id, &theirs);
        let siblings = taken.entry(node.parent.clone()).or_insert_with(|| {
            nodes
                .iter()
                .filter(|other| other.parent == node.parent)
                .map(|other| other.name.to_lowercase())
                .collect()
        });
        let name = copy_name(&node.name, doc.author_name(), &ours, siblings);
        let parent = match &node.parent {
            NodeParent::Node(parent) => Some(parent.as_str()),
            _ => None,
        };
        let copy = live
            .doc_mut()
            .add_node(parent, &name, NodeKind::Blob, Some(&ours), "")?;
        if hashes.get(&before.path) == Some(&ours) {
            let path = before.path.clone();
            previous.remove(&node.id);
            previous.insert(
                copy.clone(),
                Placed {
                    path,
                    kind: NodeKind::Blob,
                    blob: Some(ours),
                },
            );
        }
        lost.push(LostFigure {
            original: node.id.clone(),
            copy,
            by,
        });
    }
    Ok(lost)
}

pub(super) fn notices(
    live: &LiveProject,
    nodes: &[FileNode],
    previous: &Layout,
    next: &Layout,
    lost: Vec<LostFigure>,
) -> Vec<KeptFile> {
    let mut files: Vec<KeptFile> = lost
        .into_iter()
        .filter_map(|figure| {
            Some(KeptFile {
                path: next.get(&figure.original)?.path.clone(),
                copy: next.get(&figure.copy)?.path.clone(),
                id: figure.copy,
                kind: KeptKind::Replaced,
                by: figure.by,
            })
        })
        .collect();
    for clash in materialize::clashes(nodes) {
        let (Some(before), Some(after)) = (previous.get(&clash.id), next.get(&clash.id)) else {
            continue;
        };
        if before.kind == NodeKind::Dir
            || before.path == after.path
            || name_of(&before.path) != clash.name
            || parent_of(&before.path) != parent_of(&after.path)
        {
            continue;
        }
        files.push(KeptFile {
            id: clash.id.clone(),
            path: before.path.clone(),
            copy: after.path.clone(),
            kind: KeptKind::Added,
            by: live.doc().author_of(&clash.other),
        });
    }
    files
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    use oleafly_collab::doc::{NodeKind, ProjectDoc};
    use oleafly_collab::live::LiveProject;
    use oleafly_collab::materialize;
    use oleafly_collab::sync::{spawn_live, LiveLink, LiveStatus, SharedLive};
    use oleafly_collab::{ServerClient, ServerUrl};
    use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
    use oleafly_collab_protocol::projects::ProjectRole;
    use tokio::sync::mpsc;

    use super::super::{
        initial_bases, lock, Active, LiveHost, MergedPayload, NewDevicePayload,
        PresenceLeftPayload, PresencePayload, RolePayload, StatusPayload,
    };
    use super::*;
    use crate::collab::disk::{sha256_hex, DiskState};
    use crate::collab::state::CollabState;
    use crate::folder_watch::FolderChange;

    const ALICE: &str = "acct-alice";
    const BOB: &str = "acct-bob";

    #[derive(Default)]
    struct Recording {
        kept: Mutex<Vec<KeptPayload>>,
    }

    impl LiveHost for Recording {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
        fn kept(&self, payload: KeptPayload) {
            self.kept.lock().unwrap().push(payload);
        }
    }

    fn run(test: impl std::future::Future<Output = ()>) {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(test);
    }

    async fn active_for_bob(
        dir: &Path,
        root: &Path,
        live: LiveProject,
        disk: DiskState,
        host: Arc<Recording>,
    ) -> Arc<Active> {
        let state = CollabState::new(
            oleafly_collab::CollabPaths::new(dir.join("keys")),
            Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
        );
        let keys = state.keys().await.unwrap();
        let link = LiveLink {
            client: Arc::new(
                ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
            ),
            server_id: ServerId::new_v7(),
            project: SharedProjectId::new_v7(),
            device_id: DeviceId::new_v7(),
            key: Arc::clone(&keys.key),
            sessions: Arc::clone(&keys.sessions),
        };
        let bases = initial_bases(root, &disk, &live);
        let shared: SharedLive = Arc::new(Mutex::new(live));
        let (events, _events) = mpsc::unbounded_channel();
        let (writer, _writer) = mpsc::unbounded_channel();
        let handle = spawn_live(link.clone(), Arc::clone(&shared), events);
        let collab: PathBuf = dir.join("collab");
        std::fs::create_dir_all(&collab).unwrap();
        Arc::new(Active {
            project_id: "kept".to_owned(),
            root: root.to_path_buf(),
            document_dir: collab.join("document"),
            disk_file: collab.join("materializer-index.json"),
            live: shared,
            handle,
            link,
            disk: Mutex::new(disk),
            host,
            writer,
            account_id: AccountId::new_v7(),
            quiet_merge: AtomicBool::new(false),
            waiting: AtomicBool::new(false),
            last_status: Mutex::new(LiveStatus::Connecting),
            bases: Mutex::new(bases),
        })
    }

    fn signed(doc: &ProjectDoc, account: &str, name: &str) -> ProjectDoc {
        let mut copy = ProjectDoc::load(&doc.snapshot().unwrap()).unwrap();
        copy.set_author(account, name);
        copy
    }

    fn disk_of(doc: &ProjectDoc, files: &[(&str, &[u8])]) -> DiskState {
        let mut hashes = BTreeMap::new();
        for (path, bytes) in files {
            hashes.insert((*path).to_owned(), sha256_hex(bytes));
        }
        DiskState {
            layout: materialize::layout(&doc.nodes().unwrap()),
            hashes,
        }
    }

    fn busy(doc: &mut ProjectDoc) {
        let notes = doc
            .add_node(None, "notes.tex", NodeKind::Text, None, "")
            .unwrap();
        doc.set_text(&notes, &"n".repeat(200)).unwrap();
    }

    fn placed_blobs(doc: &ProjectDoc) -> BTreeMap<String, Option<String>> {
        materialize::layout(&doc.nodes().unwrap())
            .into_values()
            .filter(|placed| placed.kind == NodeKind::Blob)
            .map(|placed| (placed.path, placed.blob))
            .collect()
    }

    #[test]
    fn two_people_replacing_one_figure_keep_both_and_the_copy_is_named_for_the_person() {
        run(async {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("project");
            std::fs::create_dir_all(root.join("figs")).unwrap();
            let first = [0x89, b'P', 0];
            let alices = [0x89, b'P', 1];
            let bobs = [0x89, b'P', 2];
            let (h0, ha, hb) = (sha256_hex(&first), sha256_hex(&alices), sha256_hex(&bobs));
            let mut owner = ProjectDoc::create().unwrap();
            owner.set_author(ALICE, "Alice Chen");
            let figs = owner
                .add_node(None, "figs", NodeKind::Dir, None, "")
                .unwrap();
            let plot = owner
                .add_node(Some(&figs), "plot.png", NodeKind::Blob, Some(&h0), "")
                .unwrap();
            let mut alice = signed(&owner, ALICE, "Alice Chen");
            let mut bob = signed(&owner, BOB, "Bob Smith");
            let since = bob.version();
            busy(&mut alice);
            alice.set_blob(&plot, &ha).unwrap();
            bob.set_blob(&plot, &hb).unwrap();
            std::fs::write(root.join("figs/plot.png"), bobs).unwrap();
            let disk = disk_of(&bob, &[("figs/plot.png", &bobs)]);
            let update = alice.export_since(&since).unwrap();
            let host = Arc::new(Recording::default());
            let active = active_for_bob(
                dir.path(),
                &root,
                LiveProject::new(bob, 0, ProjectRole::Editor),
                disk,
                Arc::clone(&host),
            )
            .await;
            assert!(lock(&active.live).import_update(1, &update).unwrap());
            active.write_out().await.unwrap();
            active.handle.stop();

            let copy = "figs/plot (from Bob Smith).png";
            let mut expected = BTreeMap::new();
            expected.insert("figs/plot.png".to_owned(), Some(ha.clone()));
            expected.insert(copy.to_owned(), Some(hb.clone()));
            assert_eq!(placed_blobs(lock(&active.live).doc()), expected);
            assert_eq!(std::fs::read(root.join(copy)).unwrap(), bobs);
            let kept = host.kept.lock().unwrap().clone();
            assert_eq!(kept.len(), 1, "{kept:?}");
            assert_eq!(kept[0].project_id, "kept");
            let file = &kept[0].files;
            assert_eq!(file.len(), 1);
            assert_eq!(
                (file[0].path.as_str(), file[0].copy.as_str(), file[0].kind),
                ("figs/plot.png", copy, KeptKind::Replaced)
            );
            assert_eq!(file[0].by.as_deref(), Some(ALICE));
            let back = lock(&active.live)
                .doc()
                .export_since(&alice.version())
                .unwrap();
            alice.import(&back).unwrap();
            assert_eq!(placed_blobs(&alice), expected);
        });
    }

    #[test]
    fn replacing_a_figure_after_seeing_the_other_version_keeps_no_copy() {
        run(async {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("project");
            std::fs::create_dir_all(&root).unwrap();
            let bobs = [0x89, b'P', 2];
            let (h0, hb) = (sha256_hex(&[0x89, b'P', 0]), sha256_hex(&bobs));
            let mut owner = ProjectDoc::create().unwrap();
            owner.set_author(ALICE, "Alice Chen");
            let plot = owner
                .add_node(None, "plot.png", NodeKind::Blob, Some(&h0), "")
                .unwrap();
            let mut alice = signed(&owner, ALICE, "Alice Chen");
            let mut bob = signed(&owner, BOB, "Bob Smith");
            bob.set_blob(&plot, &hb).unwrap();
            alice
                .import(&bob.export_since(&alice.version()).unwrap())
                .unwrap();
            let since = bob.version();
            alice.set_blob(&plot, &sha256_hex(b"later")).unwrap();
            std::fs::write(root.join("plot.png"), bobs).unwrap();
            let disk = disk_of(&bob, &[("plot.png", &bobs)]);
            let host = Arc::new(Recording::default());
            let active = active_for_bob(
                dir.path(),
                &root,
                LiveProject::new(bob, 0, ProjectRole::Editor),
                disk,
                Arc::clone(&host),
            )
            .await;
            let update = alice.export_since(&since).unwrap();
            assert!(lock(&active.live).import_update(1, &update).unwrap());
            active.write_out().await.unwrap();
            active.handle.stop();
            assert_eq!(placed_blobs(lock(&active.live).doc()).len(), 1);
            assert!(host.kept.lock().unwrap().is_empty());
        });
    }

    #[test]
    fn a_file_renamed_here_because_someone_added_the_same_name_is_reported() {
        run(async {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("project");
            std::fs::create_dir_all(root.join("chapters")).unwrap();
            let mut owner = ProjectDoc::create().unwrap();
            owner.set_author(ALICE, "Alice Chen");
            let chapters = owner
                .add_node(None, "chapters", NodeKind::Dir, None, "")
                .unwrap();
            let mut alice = signed(&owner, ALICE, "Alice Chen");
            let mut bob = signed(&owner, BOB, "Bob Smith");
            let since = bob.version();
            alice
                .add_node(
                    Some(&chapters),
                    "plan.tex",
                    NodeKind::Text,
                    None,
                    "Alice's plan",
                )
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
            bob.add_node(
                Some(&chapters),
                "plan.tex",
                NodeKind::Text,
                None,
                "Bob's plan",
            )
            .unwrap();
            std::fs::write(root.join("chapters/plan.tex"), "Bob's plan").unwrap();
            let disk = disk_of(&bob, &[("chapters/plan.tex", b"Bob's plan")]);
            let host = Arc::new(Recording::default());
            let active = active_for_bob(
                dir.path(),
                &root,
                LiveProject::new(bob, 0, ProjectRole::Editor),
                disk,
                Arc::clone(&host),
            )
            .await;
            let update = alice.export_since(&since).unwrap();
            assert!(lock(&active.live).import_update(1, &update).unwrap());
            active.write_out().await.unwrap();
            active.handle.stop();

            let copy = "chapters/plan (from Bob Smith).tex";
            assert_eq!(
                std::fs::read_to_string(root.join(copy)).unwrap(),
                "Bob's plan"
            );
            assert_eq!(
                std::fs::read_to_string(root.join("chapters/plan.tex")).unwrap(),
                "Alice's plan"
            );
            let kept = host.kept.lock().unwrap().clone();
            assert_eq!(kept.len(), 1, "{kept:?}");
            let file = &kept[0].files[0];
            assert_eq!(
                (file.path.as_str(), file.copy.as_str(), file.kind),
                ("chapters/plan.tex", copy, KeptKind::Added)
            );
            assert_eq!(file.by.as_deref(), Some(ALICE));
        });
    }
}
