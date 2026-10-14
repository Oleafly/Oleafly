use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use oleafly_collab::doc::{FileNode, NodeKind, NodeParent};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout, Placed};
use oleafly_collab::CollabError;
use serde::Serialize;

use super::{guard, lock, name_of, parent_of, Active};

pub const LIVE_KEPT_EVENT: &str = "collab-live-kept";
const SHORT_HASH: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeptKind {
    Replaced,
    Added,
    Beside,
}

pub(super) const ARRIVAL_WINDOW: Duration = Duration::from_secs(10);

struct Arrival {
    id: String,
    at: Instant,
    settled: bool,
}

type Arrivals = HashMap<String, Arrival>;

static ARRIVALS: LazyLock<Mutex<HashMap<PathBuf, Arrivals>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn recent(arrivals: &mut Arrivals) {
    arrivals.retain(|_, arrival| arrival.at.elapsed() < ARRIVAL_WINDOW);
}

#[cfg(test)]
pub(super) fn age_arrivals(root: &Path, by: Duration) {
    if let Some(arrivals) = guard(&ARRIVALS).get_mut(root) {
        for arrival in arrivals.values_mut() {
            arrival.at = arrival.at.checked_sub(by).unwrap_or(arrival.at);
        }
    }
}

fn meaningful(text: &str) -> impl Iterator<Item = &str> {
    text.lines().map(str::trim).filter(|line| !line.is_empty())
}

fn replaces_every_line(before: &str, after: &str) -> bool {
    let kept: HashSet<&str> = meaningful(after).collect();
    let mut lines = meaningful(before).peekable();
    !kept.is_empty() && lines.peek().is_some() && lines.all(|line| !kept.contains(line))
}

fn from_someone_else(live: &LiveProject, id: &str) -> bool {
    let by = live.doc().author_of(id);
    by.is_some() && by.as_deref() != live.doc().author_key()
}

pub(super) fn take_replaced_arrival(
    root: &Path,
    live: &LiveProject,
    received: Option<&str>,
    path: &str,
    id: &str,
    text: &str,
) -> bool {
    if live.is_open(id) || !from_someone_else(live, id) {
        return false;
    }
    let mut all = guard(&ARRIVALS);
    let Some(arrivals) = all.get_mut(root) else {
        return false;
    };
    recent(arrivals);
    let Some(arrival) = arrivals
        .get_mut(path)
        .filter(|arrival| arrival.id == id && !arrival.settled)
    else {
        return false;
    };
    let replaced = match received {
        Some(received) => replaces_every_line(received, text),
        None => live
            .doc()
            .text(id)
            .is_ok_and(|current| replaces_every_line(&current, text)),
    };
    if replaced {
        arrival.settled = true;
    }
    replaced
}

impl Active {
    pub(super) fn note_arrivals(&self, previous: &Layout, written: &BTreeSet<String>) {
        if previous.is_empty() || written.is_empty() {
            return;
        }
        let fresh: Vec<(String, String)> = guard(&self.disk)
            .layout
            .iter()
            .filter(|(id, placed)| {
                placed.kind == NodeKind::Text
                    && !previous.contains_key(*id)
                    && written.contains(&placed.path)
            })
            .map(|(id, placed)| (id.clone(), placed.path.clone()))
            .collect();
        if fresh.is_empty() {
            return;
        }
        let theirs: Vec<(String, String)> = {
            let live = lock(&self.live);
            fresh
                .into_iter()
                .filter(|(id, _)| from_someone_else(&live, id))
                .collect()
        };
        if theirs.is_empty() {
            return;
        }
        let mut all = guard(&ARRIVALS);
        let arrivals = all.entry(self.root.clone()).or_default();
        recent(arrivals);
        for (id, path) in theirs {
            if arrivals.get(&path).is_some_and(|known| known.id == id) {
                continue;
            }
            arrivals.insert(
                path,
                Arrival {
                    id,
                    at: Instant::now(),
                    settled: false,
                },
            );
        }
    }
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

pub(super) fn copy_name(
    name: &str,
    author: Option<&str>,
    hash: &str,
    taken: &mut BTreeSet<String>,
) -> String {
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
    let me = live.doc().author_key();
    for clash in materialize::clashes(nodes) {
        let Some(after) = next.get(&clash.id) else {
            continue;
        };
        let Some(before) = previous.get(&clash.id) else {
            let kept = previous
                .get(&clash.other)
                .zip(next.get(&clash.other))
                .filter(|(was, now)| was.path == now.path);
            let by = live.doc().author_of(&clash.id);
            let mine = me.is_some()
                && live.doc().author_of(&clash.other).as_deref() == me
                && by.as_deref() != me;
            if let Some((_, now)) = kept.filter(|_| mine && after.kind != NodeKind::Dir) {
                files.push(KeptFile {
                    id: clash.id.clone(),
                    path: now.path.clone(),
                    copy: after.path.clone(),
                    kind: KeptKind::Beside,
                    by,
                });
            }
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
            upkeep: Default::default(),
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
    fn a_same_name_file_from_your_other_computer_is_not_announced_as_someone_elses() {
        run(async {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("project");
            std::fs::create_dir_all(root.join("chapters")).unwrap();
            let mut owner = ProjectDoc::create().unwrap();
            owner.set_author(ALICE, "Alice Chen");
            let chapters = owner
                .add_node(None, "chapters", NodeKind::Dir, None, "")
                .unwrap();
            let mut desktop = signed(&owner, BOB, "Bob Smith");
            let mut laptop = signed(&owner, BOB, "Bob Smith");
            let since = laptop.version();
            desktop
                .add_node(
                    Some(&chapters),
                    "plan.tex",
                    NodeKind::Text,
                    None,
                    "Desktop plan",
                )
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
            laptop
                .add_node(
                    Some(&chapters),
                    "plan.tex",
                    NodeKind::Text,
                    None,
                    "Laptop plan",
                )
                .unwrap();
            std::fs::write(root.join("chapters/plan.tex"), "Desktop plan").unwrap();
            let disk = disk_of(&desktop, &[("chapters/plan.tex", b"Desktop plan")]);
            let host = Arc::new(Recording::default());
            let active = active_for_bob(
                dir.path(),
                &root,
                LiveProject::new(desktop, 0, ProjectRole::Editor),
                disk,
                Arc::clone(&host),
            )
            .await;
            let update = laptop.export_since(&since).unwrap();
            assert!(lock(&active.live).import_update(1, &update).unwrap());
            active.write_out().await.unwrap();
            active.handle.stop();
            assert_eq!(placed_texts(lock(&active.live).doc()).len(), 2);
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

    fn placed_texts(doc: &ProjectDoc) -> BTreeMap<String, String> {
        materialize::layout(&doc.nodes().unwrap())
            .into_iter()
            .filter(|(_, placed)| placed.kind == NodeKind::Text)
            .map(|(id, placed)| (placed.path, doc.text(&id).unwrap()))
            .collect()
    }

    struct Arrived {
        dir: tempfile::TempDir,
        root: PathBuf,
        sender: ProjectDoc,
        active: Arc<Active>,
        host: Arc<Recording>,
        plan: String,
    }

    impl Arrived {
        fn read(&self, path: &str) -> String {
            std::fs::read_to_string(self.root.join(path)).unwrap()
        }

        async fn replace(&self, text: &str) {
            std::fs::write(self.root.join("sections/plan.tex"), text).unwrap();
            self.active
                .import_paths(Some(vec!["sections/plan.tex".to_owned()]))
                .await
                .unwrap();
            self.active.write_out().await.unwrap();
        }

        fn texts(&self) -> BTreeMap<String, String> {
            placed_texts(lock(&self.active.live).doc())
        }

        fn kept(&self) -> Vec<KeptFile> {
            self.host
                .kept
                .lock()
                .unwrap()
                .iter()
                .flat_map(|payload| payload.files.clone())
                .collect()
        }
    }

    async fn plan_from(account: &str, name: &str, text: &str) -> Arrived {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(root.join("sections")).unwrap();
        let mut owner = ProjectDoc::create().unwrap();
        owner.set_author(ALICE, "Alice Chen");
        let sections = owner
            .add_node(None, "sections", NodeKind::Dir, None, "")
            .unwrap();
        let mut sender = signed(&owner, account, name);
        let bob = signed(&owner, BOB, "Bob Smith");
        let since = bob.version();
        let disk = disk_of(&bob, &[]);
        let plan = sender
            .add_node(Some(&sections), "plan.tex", NodeKind::Text, None, text)
            .unwrap();
        let host = Arc::new(Recording::default());
        let active = active_for_bob(
            dir.path(),
            &root,
            LiveProject::new(bob, 0, ProjectRole::Editor),
            disk,
            Arc::clone(&host),
        )
        .await;
        let update = sender.export_since(&since).unwrap();
        assert!(lock(&active.live).import_update(1, &update).unwrap());
        active.write_out().await.unwrap();
        let arrived = Arrived {
            dir,
            root,
            sender,
            active,
            host,
            plan,
        };
        assert_eq!(arrived.read("sections/plan.tex"), text);
        arrived
    }

    fn only_plan(text: &str) -> BTreeMap<String, String> {
        let mut expected = BTreeMap::new();
        expected.insert("sections/plan.tex".to_owned(), text.to_owned());
        expected
    }

    #[test]
    fn a_file_replaced_moments_after_it_arrived_from_someone_else_keeps_both_and_tells_both_people()
    {
        run(async {
            let alices = "Third plan by alice.\n";
            let bobs = "Third plan by bob.\n";
            let arrived = plan_from(ALICE, "Alice Chen", alices).await;
            arrived.replace(bobs).await;
            arrived.active.handle.stop();

            let copy = "sections/plan (from Bob Smith).tex";
            let mut expected = only_plan(alices);
            expected.insert(copy.to_owned(), bobs.to_owned());
            assert_eq!(arrived.texts(), expected);
            assert_eq!(arrived.read("sections/plan.tex"), alices);
            assert_eq!(arrived.read(copy), bobs);
            let kept = arrived.kept();
            assert_eq!(kept.len(), 1, "{kept:?}");
            assert_eq!(
                (kept[0].path.as_str(), kept[0].copy.as_str(), kept[0].kind),
                ("sections/plan.tex", copy, KeptKind::Added)
            );
            assert_eq!(kept[0].by.as_deref(), Some(ALICE));

            let alice_root = arrived.dir.path().join("alice");
            std::fs::create_dir_all(alice_root.join("sections")).unwrap();
            std::fs::write(alice_root.join("sections/plan.tex"), alices).unwrap();
            let alice_doc = signed(&arrived.sender, ALICE, "Alice Chen");
            let since = alice_doc.version();
            let alice_disk = disk_of(&alice_doc, &[("sections/plan.tex", alices.as_bytes())]);
            let alice_host = Arc::new(Recording::default());
            let alice_dir = tempfile::tempdir().unwrap();
            let alice = active_for_bob(
                alice_dir.path(),
                &alice_root,
                LiveProject::new(alice_doc, 0, ProjectRole::Owner),
                alice_disk,
                Arc::clone(&alice_host),
            )
            .await;
            let update = lock(&arrived.active.live)
                .doc()
                .export_since(&since)
                .unwrap();
            assert!(lock(&alice.live).import_update(1, &update).unwrap());
            alice.write_out().await.unwrap();
            alice.handle.stop();
            assert_eq!(placed_texts(lock(&alice.live).doc()), expected);
            assert_eq!(
                std::fs::read_to_string(alice_root.join(copy)).unwrap(),
                bobs
            );
            let told: Vec<KeptFile> = alice_host
                .kept
                .lock()
                .unwrap()
                .iter()
                .flat_map(|payload| payload.files.clone())
                .collect();
            assert_eq!(told.len(), 1, "{told:?}");
            assert_eq!(
                (told[0].path.as_str(), told[0].copy.as_str(), told[0].kind),
                ("sections/plan.tex", copy, KeptKind::Beside)
            );
            assert_eq!(told[0].by.as_deref(), Some(BOB));
        });
    }

    #[test]
    fn a_change_that_keeps_part_of_a_file_that_just_arrived_stays_an_edit() {
        run(async {
            let arrived = plan_from(ALICE, "Alice Chen", "Plan by alice.\nShared intro.\n").await;
            let bobs = "Plan by bob.\nShared intro.\n";
            arrived.replace(bobs).await;
            arrived.active.handle.stop();
            assert_eq!(arrived.texts(), only_plan(bobs));
            assert!(arrived.kept().is_empty());
        });
    }

    #[test]
    fn replacing_a_file_that_is_open_here_stays_an_edit() {
        run(async {
            let arrived = plan_from(ALICE, "Alice Chen", "Third plan by alice.\n").await;
            let sink: oleafly_collab::live::DocSink = Arc::new(|_| {});
            lock(&arrived.active.live)
                .open_file(&arrived.plan, sink)
                .unwrap();
            let bobs = "Third plan by bob.\n";
            arrived.replace(bobs).await;
            arrived.active.handle.stop();
            assert_eq!(arrived.texts(), only_plan(bobs));
            assert!(arrived.kept().is_empty());
        });
    }

    #[test]
    fn replacing_a_file_long_after_it_arrived_stays_an_edit() {
        run(async {
            let arrived = plan_from(ALICE, "Alice Chen", "Third plan by alice.\n").await;
            super::age_arrivals(&arrived.root, super::ARRIVAL_WINDOW);
            let bobs = "Third plan by bob.\n";
            arrived.replace(bobs).await;
            arrived.active.handle.stop();
            assert_eq!(arrived.texts(), only_plan(bobs));
            assert!(arrived.kept().is_empty());
        });
    }

    #[test]
    fn replacing_your_own_file_from_another_computer_stays_an_edit() {
        run(async {
            let arrived = plan_from(BOB, "Bob Smith", "Plan from the laptop.\n").await;
            let bobs = "Plan from the desktop.\n";
            arrived.replace(bobs).await;
            arrived.active.handle.stop();
            assert_eq!(arrived.texts(), only_plan(bobs));
            assert!(arrived.kept().is_empty());
        });
    }

    struct Figure {
        active: Arc<Active>,
        host: Arc<Recording>,
        root: PathBuf,
        bytes: [u8; 3],
    }

    impl Figure {
        async fn start(dir: &Path, owner: &ProjectDoc, who: (&str, &str, u8)) -> Figure {
            let (account, name, mark) = who;
            let place = dir.join(account);
            let root = place.join("project");
            std::fs::create_dir_all(root.join("figs")).unwrap();
            let first = [0x89, b'P', 0];
            std::fs::write(root.join("figs/plot.png"), first).unwrap();
            let doc = signed(owner, account, name);
            let disk = disk_of(&doc, &[("figs/plot.png", &first)]);
            let host = Arc::new(Recording::default());
            let active = active_for_bob(
                &place,
                &root,
                LiveProject::new(doc, 0, ProjectRole::Editor),
                disk,
                Arc::clone(&host),
            )
            .await;
            Figure {
                active,
                host,
                root,
                bytes: [0x89, b'P', mark],
            }
        }

        fn replace_on_disk(&self) {
            std::fs::write(self.root.join("figs/plot.png"), self.bytes).unwrap();
            let only = ["figs/plot.png".to_owned()];
            let snapshot = guard(&self.active.disk).clone();
            let import = {
                let live = lock(&self.active.live);
                super::super::read_local_changes(&self.root, &snapshot, &live, Some(&only)).unwrap()
            };
            let mut disk = guard(&self.active.disk);
            let mut live = lock(&self.active.live);
            let mut bases = guard(&self.active.bases);
            assert!(super::super::apply_local_import(
                &mut live, &mut disk, &mut bases, import, &self.root
            )
            .unwrap());
        }

        fn hash(&self) -> String {
            sha256_hex(&self.bytes)
        }

        fn blobs(&self) -> BTreeMap<String, Option<String>> {
            placed_blobs(lock(&self.active.live).doc())
        }

        fn told(&self) -> Vec<KeptFile> {
            self.host
                .kept
                .lock()
                .unwrap()
                .iter()
                .flat_map(|payload| payload.files.clone())
                .collect()
        }
    }

    fn deliver(from: &Figure, to: &Figure, seq: u64, with: Vec<Vec<u8>>) {
        let known = lock(&to.active.live).doc().version();
        let payload = lock(&from.active.live).doc().export_since(&known).unwrap();
        let arrivals = with
            .into_iter()
            .chain([payload])
            .enumerate()
            .map(|(index, payload)| oleafly_collab::live::Arrival {
                seq: seq + index as u64,
                payload,
                device: None,
                author: None,
            })
            .collect();
        lock(&to.active.live).import_arrivals(arrivals).unwrap();
    }

    async fn settle(alice: &Figure, bob: &Figure) {
        for (seq, (from, to)) in [(alice, bob), (bob, alice), (alice, bob), (bob, alice)]
            .into_iter()
            .enumerate()
        {
            deliver(from, to, 100 + 10 * seq as u64, Vec::new());
            to.active.write_out().await.unwrap();
        }
    }

    fn both_versions_survive(alice: &Figure, bob: &Figure) {
        let everywhere = alice.blobs();
        assert_eq!(everywhere, bob.blobs());
        let shown = everywhere.get("figs/plot.png").cloned().flatten();
        let (winner, loser, name) = if shown == Some(bob.hash()) {
            (bob, alice, "Alice Chen")
        } else {
            (alice, bob, "Bob Smith")
        };
        let copy = format!("figs/plot (from {name}).png");
        let mut expected = BTreeMap::new();
        expected.insert("figs/plot.png".to_owned(), Some(winner.hash()));
        expected.insert(copy.clone(), Some(loser.hash()));
        assert_eq!(everywhere, expected);
        assert_eq!(std::fs::read(loser.root.join(&copy)).unwrap(), loser.bytes);
        let told = loser.told();
        assert!(
            told.iter().any(|file| file.kind == KeptKind::Replaced
                && file.path == "figs/plot.png"
                && file.copy == copy),
            "{told:?}"
        );
    }

    fn owner_of_one_figure() -> ProjectDoc {
        let mut owner = ProjectDoc::create().unwrap();
        owner.set_author(ALICE, "Alice Chen");
        let figs = owner
            .add_node(None, "figs", NodeKind::Dir, None, "")
            .unwrap();
        owner
            .add_node(
                Some(&figs),
                "plot.png",
                NodeKind::Blob,
                Some(&sha256_hex(&[0x89, b'P', 0])),
                "",
            )
            .unwrap();
        owner
    }

    #[test]
    fn a_figure_replaced_here_while_another_replacement_was_on_its_way_keeps_both_everywhere() {
        run(async {
            let dir = tempfile::tempdir().unwrap();
            let owner = owner_of_one_figure();
            let alice = Figure::start(dir.path(), &owner, (ALICE, "Alice Chen", 1)).await;
            let bob = Figure::start(dir.path(), &owner, (BOB, "Bob Smith", 2)).await;
            alice.replace_on_disk();
            deliver(&alice, &bob, 1, Vec::new());
            bob.replace_on_disk();
            settle(&alice, &bob).await;
            alice.active.handle.stop();
            bob.active.handle.stop();
            both_versions_survive(&alice, &bob);
        });
    }

    #[test]
    fn a_figure_both_people_replaced_offline_keeps_both_when_their_changes_arrive_together() {
        run(async {
            let dir = tempfile::tempdir().unwrap();
            let owner = owner_of_one_figure();
            let alice = Figure::start(dir.path(), &owner, (ALICE, "Alice Chen", 1)).await;
            let bob = Figure::start(dir.path(), &owner, (BOB, "Bob Smith", 2)).await;
            alice.replace_on_disk();
            bob.replace_on_disk();
            let mut typing = signed(&owner, "acct-carol", "Carol Diaz");
            let since = typing.version();
            busy(&mut typing);
            let other = typing.export_since(&since).unwrap();
            deliver(&alice, &bob, 1, vec![other.clone()]);
            deliver(&bob, &alice, 1, vec![other]);
            alice.active.write_out().await.unwrap();
            bob.active.write_out().await.unwrap();
            settle(&alice, &bob).await;
            alice.active.handle.stop();
            bob.active.handle.stop();
            both_versions_survive(&alice, &bob);
        });
    }
}
