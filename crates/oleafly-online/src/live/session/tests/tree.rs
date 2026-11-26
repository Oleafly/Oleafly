use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::super::state::{Handshake, State};
use super::super::{
    Account, DocStopReason, LivePeer, LivePort, LiveState, MergeReview, OverleafSession,
    SessionTuning,
};
use super::{eventually, project, tuning, Rig, Tab, MAIN, NOTES, WAIT};
use crate::live::journal::Journal;
use crate::live::rest::ProjectRest;
use crate::live::tree_queue::{
    LocalFile, QueueState, Queued, TreeChange, TreeFailure, TreeRefusal, MAX_UPLOAD_BYTES,
};
use crate::live::{DocId, PublicId};
use crate::realtime::codec;
use crate::realtime::events::{EntityId, ProjectEvent, ServerEvent};
use crate::realtime::project::{ProjectState, Role};
use crate::realtime::tree::{NodeKind, PathChange};
use crate::realtime::ProjectPage;
use crate::test_support::mock_overleaf::Fault;
use crate::test_support::overleaf_rt::{probe_frames, recordings, Trace};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nplot";

#[derive(Default)]
pub(super) struct Seen {
    queues: Vec<Vec<Queued>>,
    uploaded: Vec<(String, String, Option<String>)>,
    pub(super) stopped: Vec<(DocId, DocStopReason)>,
    merged: Vec<(DocId, MergeReview)>,
    pub(super) trees: Vec<Vec<PathChange>>,
    states: Vec<LiveState>,
    order: Vec<String>,
    read: Vec<String>,
}

#[derive(Default)]
pub(super) struct TreePort {
    texts: Mutex<BTreeMap<String, String>>,
    files: Mutex<BTreeMap<String, Vec<u8>>>,
    sizes: Mutex<BTreeMap<String, u64>>,
    folder: Option<PathBuf>,
    seen: Mutex<Seen>,
}

impl TreePort {
    pub(super) fn new() -> Arc<TreePort> {
        Arc::new(TreePort::default())
    }

    fn in_folder(folder: PathBuf) -> Arc<TreePort> {
        Arc::new(TreePort {
            folder: Some(folder),
            ..TreePort::default()
        })
    }

    pub(super) fn text(&self, path: &str, text: &str) {
        self.texts
            .lock()
            .unwrap()
            .insert(path.to_string(), text.to_string());
    }

    fn file(&self, path: &str, bytes: &[u8]) {
        self.files
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes.to_vec());
    }

    pub(super) fn seen(&self) -> MutexGuard<'_, Seen> {
        self.seen.lock().unwrap()
    }

    fn queue(&self) -> Vec<Queued> {
        self.seen().queues.last().cloned().unwrap_or_default()
    }
}

impl LivePort for TreePort {
    fn state(&self, state: LiveState) {
        self.seen().states.push(state);
    }

    fn role(&self, _role: Role, _tracking: bool) {}

    fn texts_changed(&self, _docs: Vec<DocId>) {}

    fn tree_changed(&self, changes: Vec<PathChange>) {
        let mut seen = self.seen();
        for change in &changes {
            if let PathChange::Removed { id, .. } = change {
                seen.order.push(format!("removed {}", id.0));
            }
        }
        seen.trees.push(changes);
    }

    fn peer(&self, _peer: LivePeer) {}

    fn peer_left(&self, _id: &PublicId) {}

    fn doc_stopped(&self, doc: &DocId, reason: DocStopReason) {
        let mut seen = self.seen();
        seen.order.push(format!("stopped {}", doc.0));
        seen.stopped.push((doc.clone(), reason));
    }

    fn project_event(&self, _event: ProjectEvent) {}

    fn merged(&self, doc: &DocId, review: MergeReview) {
        let mut seen = self.seen();
        if matches!(review, MergeReview::Kept { .. }) {
            seen.order.push(format!("kept {}", doc.0));
        }
        seen.merged.push((doc.clone(), review));
    }

    fn journal_failed(&self, _reason: Option<String>) {}

    fn disk_text(&self, path: &str) -> Option<String> {
        if let Some(text) = self.texts.lock().unwrap().get(path) {
            return Some(text.clone());
        }
        let bytes = self.files.lock().unwrap().get(path).cloned()?;
        String::from_utf8(bytes).ok()
    }

    fn tree_queue(&self, changes: Vec<Queued>) {
        self.seen().queues.push(changes);
    }

    fn uploaded(&self, path: &str, tag: &str, hash: Option<&str>) {
        self.seen()
            .uploaded
            .push((path.to_string(), tag.to_string(), hash.map(str::to_string)));
    }

    fn local_file_size(&self, path: &str) -> Option<u64> {
        self.sizes.lock().unwrap().get(path).copied()
    }

    fn local_file(&self, path: &str) -> Option<LocalFile> {
        self.seen().read.push(path.to_string());
        let bytes = match self.files.lock().unwrap().get(path) {
            Some(bytes) => bytes.clone(),
            None => self.texts.lock().unwrap().get(path)?.clone().into_bytes(),
        };
        Some(LocalFile {
            tag: format!("tag-{}", bytes.len()),
            bytes,
        })
    }

    fn never_online(&self, path: &str) -> bool {
        match &self.folder {
            Some(folder) => crate::sync::never_online(folder, path),
            None => crate::sync::excluded(path),
        }
    }
}

pub(super) fn quick() -> SessionTuning {
    SessionTuning {
        tree_retry: Duration::from_millis(50),
        rate_floor: Duration::from_millis(300),
        delete_settle: Duration::from_millis(300),
        ..tuning()
    }
}

pub(super) async fn live_as(
    rig: &Rig,
    name: &str,
    port: &Arc<TreePort>,
    tuning: SessionTuning,
) -> Arc<OverleafSession> {
    rig.seed(name, 0).await;
    resume_as(rig, name, port, tuning).await
}

async fn resume_as(
    rig: &Rig,
    name: &str,
    port: &Arc<TreePort>,
    tuning: SessionTuning,
) -> Arc<OverleafSession> {
    let journal = rig.journal(name).await;
    let shared = Arc::clone(port) as Arc<dyn LivePort>;
    let live = OverleafSession::start(rig.config(name, tuning), shared, journal)
        .await
        .unwrap();
    eventually("the session is online", || {
        port.seen()
            .states
            .iter()
            .any(|state| matches!(state, LiveState::Online { .. }))
    })
    .await;
    live
}

fn calls_where(rig: &Rig, method: &str, route: &str, exact: bool) -> usize {
    let wanted = format!("/project/{}{route}", rig.mock.project_id());
    rig.mock
        .requests(&wanted)
        .into_iter()
        .filter(|request| request.method == method)
        .filter(|request| {
            let path = request.path.split('?').next().unwrap_or_default();
            !exact || path == wanted
        })
        .count()
}

fn requests(rig: &Rig, method: &str, route: &str) -> usize {
    calls_where(rig, method, route, true)
}

fn requests_under(rig: &Rig, method: &str, route: &str) -> usize {
    calls_where(rig, method, route, false)
}

fn path_of(live: &OverleafSession, path: &str) -> Option<NodeKind> {
    let nodes = live.nodes();
    let mut tree = BTreeMap::new();
    for node in &nodes {
        tree.insert(node.id.clone(), node.clone());
    }
    nodes
        .iter()
        .find(|node| {
            let mut parts = vec![node.name.clone()];
            let mut parent = node.parent.clone();
            while let Some(id) = parent {
                match tree.get(&id) {
                    Some(above) => {
                        parts.push(above.name.clone());
                        parent = above.parent.clone();
                    }
                    None => break,
                }
            }
            parts.reverse();
            parts.join("/") == path
        })
        .map(|node| node.kind)
}

async fn as_bob(rig: &Rig) -> (ProjectRest, crate::session::SessionHandle) {
    let bob = rig.handle_for(&rig.mock.user("bob"));
    let page = ProjectPage::load(&rig.http, &bob, &rig.mock.project_id(), false)
        .await
        .unwrap();
    (
        ProjectRest::new(rig.http.clone(), Arc::new(page), &rig.mock.project_id()),
        bob,
    )
}

async fn queue_empty(port: &TreePort) {
    eventually("the queue drains", || {
        let seen = port.seen();
        !seen.queues.is_empty() && seen.queues.last().is_some_and(Vec::is_empty)
    })
    .await;
}

#[tokio::test]
async fn a_new_local_tex_is_created_then_filled_by_op() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    port.text("appendix.tex", "Appendix text");
    live.change_tree(TreeChange::NewDoc {
        path: "appendix.tex".into(),
    })
    .unwrap();
    eventually("the new doc has its text on the server", || {
        rig.mock
            .entity_id("appendix.tex")
            .is_some_and(|id| rig.mock.doc_text(&id) == "Appendix text")
    })
    .await;
    queue_empty(&port).await;
    assert_eq!(requests(&rig, "POST", "/doc"), 1);
    assert_eq!(requests(&rig, "POST", "/upload"), 0);
    let doc = DocId(rig.mock.entity_id("appendix.tex").unwrap());
    let sent = rig.updates_for(&doc);
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(live.text(&doc).as_deref(), Some("Appendix text"));
    live.stop().await;
}

#[tokio::test]
async fn new_file_with_emoji_stays_a_doc() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    port.text("emoji.tex", "Hi 😀 there");
    live.change_tree(TreeChange::NewDoc {
        path: "emoji.tex".into(),
    })
    .unwrap();
    eventually("the doc is filled", || {
        rig.mock
            .entity_id("emoji.tex")
            .is_some_and(|id| !rig.mock.doc_text(&id).is_empty())
    })
    .await;
    let id = rig.mock.entity_id("emoji.tex").unwrap();
    assert_eq!(rig.mock.doc_text(&id), "Hi \u{FFFD}\u{FFFD} there");
    assert_eq!(path_of(&live, "emoji.tex"), Some(NodeKind::Doc));
    assert_eq!(requests(&rig, "POST", "/upload"), 0);
    live.stop().await;
}

#[tokio::test]
async fn a_new_text_file_over_two_mib_is_uploaded_as_a_file() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let big = "a".repeat(2 * 1024 * 1024 + 1);
    port.text("data.tex", &big);
    live.change_tree(TreeChange::NewDoc {
        path: "data.tex".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    eventually("the file is in the tree", || {
        path_of(&live, "data.tex") == Some(NodeKind::File)
    })
    .await;
    assert_eq!(requests(&rig, "POST", "/doc"), 0);
    assert_eq!(requests(&rig, "POST", "/upload"), 1);
    live.stop().await;
}

#[tokio::test]
async fn a_new_binary_is_uploaded_once() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    port.file("figures/plot.png", PNG);
    for _ in 0..3 {
        live.change_tree(TreeChange::Upload {
            path: "figures/plot.png".into(),
        })
        .unwrap();
    }
    queue_empty(&port).await;
    assert_eq!(requests(&rig, "POST", "/upload"), 1);
    assert_eq!(requests(&rig, "POST", "/folder"), 1);
    assert_eq!(path_of(&live, "figures/plot.png"), Some(NodeKind::File));
    let uploaded = port.seen().uploaded.clone();
    assert_eq!(uploaded.len(), 1);
    assert_eq!(uploaded[0].0, "figures/plot.png");
    assert_eq!(uploaded[0].1, format!("tag-{}", PNG.len()));
    assert!(uploaded[0].2.is_some());
    live.stop().await;
}

#[tokio::test]
async fn a_local_rename_is_one_rest_call_confirmed_by_the_room() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let notes = rig.mock.entity_id(NOTES).unwrap();
    rig.mock.hold_updates();
    live.change_tree(TreeChange::Move {
        from: NOTES.into(),
        to: "chapters-notes.tex".into(),
    })
    .unwrap();
    assert_eq!(path_of(&live, "chapters-notes.tex"), Some(NodeKind::Doc));
    assert_eq!(path_of(&live, NOTES), None);
    rig.mock.release_updates();
    queue_empty(&port).await;
    eventually("the server has the new name", || {
        rig.mock.entity_id("chapters-notes.tex").as_deref() == Some(notes.as_str())
    })
    .await;
    assert_eq!(requests(&rig, "POST", &format!("/doc/{notes}/rename")), 1);
    assert_eq!(requests(&rig, "POST", &format!("/doc/{notes}/move")), 0);
    assert_eq!(requests_under(&rig, "DELETE", ""), 0);
    assert_eq!(requests(&rig, "POST", "/doc"), 0);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(path_of(&live, "chapters-notes.tex"), Some(NodeKind::Doc));
    let flapped = port
        .seen()
        .trees
        .iter()
        .flatten()
        .any(|change| matches!(change, PathChange::Moved { to, .. } if to == NOTES));
    assert!(!flapped, "the rename went back and forth");
    live.stop().await;
}

#[tokio::test]
async fn a_move_and_rename_into_a_folder_is_two_calls_never_delete_and_create() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let notes = rig.mock.entity_id(NOTES).unwrap();
    live.change_tree(TreeChange::Move {
        from: NOTES.into(),
        to: "sections/later.tex".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    assert_eq!(
        rig.mock.entity_id("sections/later.tex").as_deref(),
        Some(notes.as_str())
    );
    assert_eq!(requests(&rig, "POST", &format!("/doc/{notes}/move")), 1);
    assert_eq!(requests(&rig, "POST", &format!("/doc/{notes}/rename")), 1);
    assert_eq!(requests_under(&rig, "DELETE", ""), 0);
    live.stop().await;
}

#[tokio::test]
async fn a_refused_upload_shows_retry() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let route = format!("/project/{}/upload", rig.mock.project_id());
    rig.mock.plan_fault(
        Some("POST"),
        &route,
        Fault::Reply(
            422,
            r#"{"success":false,"error":"invalid filename"}"#.into(),
        ),
    );
    port.file("plot.png", PNG);
    live.change_tree(TreeChange::Upload {
        path: "plot.png".into(),
    })
    .unwrap();
    eventually("the upload shows as failed", || {
        port.queue().iter().any(|queued| {
            queued.state
                == QueueState::Failed {
                    failure: TreeFailure::Refused("invalid filename".into()),
                }
        })
    })
    .await;
    assert_eq!(path_of(&live, "plot.png"), None);
    live.retry_tree(Some("plot.png"));
    queue_empty(&port).await;
    assert_eq!(path_of(&live, "plot.png"), Some(NodeKind::File));
    assert_eq!(requests(&rig, "POST", "/upload"), 2);
    live.stop().await;
}

#[tokio::test]
async fn a_file_over_the_limit_is_refused_without_being_read() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    port.file("huge.png", PNG);
    port.sizes
        .lock()
        .unwrap()
        .insert("huge.png".into(), MAX_UPLOAD_BYTES + 1);
    live.change_tree(TreeChange::Upload {
        path: "huge.png".into(),
    })
    .unwrap();
    eventually("the upload shows as too large", || {
        port.queue().iter().any(|queued| {
            queued.state
                == QueueState::Failed {
                    failure: TreeFailure::TooLarge,
                }
        })
    })
    .await;
    assert!(port.seen().read.is_empty(), "{:?}", port.seen().read);
    assert_eq!(requests(&rig, "POST", "/upload"), 0);
    live.stop().await;
}

#[tokio::test]
async fn stop_does_not_wait_for_a_slow_rest_call() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let route = format!("/project/{}/doc", rig.mock.project_id());
    rig.mock
        .plan_fault(Some("POST"), &route, Fault::Delay(Duration::from_secs(60)));
    port.text("slow.tex", "Slow");
    let change = TreeChange::NewDoc {
        path: "slow.tex".into(),
    };
    live.change_tree(change.clone()).unwrap();
    eventually("the create is on its way", || {
        requests(&rig, "POST", "/doc") == 1
    })
    .await;
    let stopping = Instant::now();
    live.stop().await;
    let waited = stopping.elapsed();
    assert!(waited < Duration::from_secs(10), "{waited:?}");
    drop(live);
    let journal = rig.journal("alice").await;
    assert!(
        journal
            .tree_queue()
            .iter()
            .any(|queued| queued.is_waiting() && queued.change == change),
        "{:?}",
        journal.tree_queue()
    );
}

#[tokio::test]
async fn a_refused_new_doc_never_fills_a_coauthors_doc_at_that_path() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let route = format!("/project/{}/doc", rig.mock.project_id());
    rig.mock.plan_fault(
        Some("POST"),
        &route,
        Fault::Reply(400, "invalid name".into()),
    );
    port.text("appendix.tex", "Alice's appendix");
    live.change_tree(TreeChange::NewDoc {
        path: "appendix.tex".into(),
    })
    .unwrap();
    eventually("the create shows as failed", || {
        port.queue().iter().any(|queued| !queued.is_waiting())
    })
    .await;
    let (rest, bob) = as_bob(&rig).await;
    let root = EntityId(rig.mock.root_folder_id());
    let made = rest.create_doc(&bob, &root, "appendix.tex").await.unwrap();
    let doc = DocId(made.0);
    eventually("alice sees bob's doc", || {
        live.doc_at("appendix.tex").as_ref() == Some(&doc)
    })
    .await;
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        rig.updates_for(&doc).is_empty(),
        "{:?}",
        rig.updates_for(&doc)
    );
    assert_eq!(rig.mock.doc_text(&doc.0), "");
    live.stop().await;
}

#[tokio::test]
async fn a_dismissed_failed_rename_puts_the_file_back() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let notes = rig.mock.entity_id(NOTES).unwrap();
    let route = format!("/project/{}/doc/{notes}/rename", rig.mock.project_id());
    rig.mock.plan_fault(
        Some("POST"),
        &route,
        Fault::Reply(400, "invalid name".into()),
    );
    live.change_tree(TreeChange::Move {
        from: NOTES.into(),
        to: "bad.tex".into(),
    })
    .unwrap();
    eventually("the rename shows as failed", || {
        port.queue().iter().any(|queued| !queued.is_waiting())
    })
    .await;
    assert_eq!(path_of(&live, "bad.tex"), Some(NodeKind::Doc));
    live.dismiss_tree("bad.tex");
    assert_eq!(path_of(&live, NOTES), Some(NodeKind::Doc));
    assert!(port.queue().is_empty());
    live.stop().await;
}

#[tokio::test]
async fn a_stale_csrf_token_is_refreshed_once() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    live.change_tree(TreeChange::NewFolder {
        path: "first".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    let pages = requests(&rig, "GET", "");
    rig.mock.rotate_csrf();
    live.change_tree(TreeChange::NewFolder {
        path: "second".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    assert!(rig.mock.entity_id("second").is_some());
    assert_eq!(requests(&rig, "POST", "/folder"), 3);
    assert_eq!(requests(&rig, "GET", ""), pages + 1);
    live.stop().await;
}

#[tokio::test]
async fn build_outputs_never_upload() {
    let folder = tempfile::tempdir().unwrap();
    tokio::fs::write(folder.path().join("main.tex"), "x")
        .await
        .unwrap();
    tokio::fs::write(folder.path().join("main.pdf"), "pdf")
        .await
        .unwrap();
    let rig = Rig::start(project()).await;
    let port = TreePort::in_folder(folder.path().to_path_buf());
    let live = live_as(&rig, "alice", &port, quick()).await;
    for path in ["main.pdf", "main.aux", ".oleafly/online/live.lock", ".env"] {
        assert_eq!(
            live.change_tree(TreeChange::Upload { path: path.into() }),
            Err(TreeRefusal::NeverOnline),
            "{path}"
        );
    }
    port.file("figure-2.png", PNG);
    live.change_tree(TreeChange::Upload {
        path: "figure-2.png".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    assert_eq!(requests(&rig, "POST", "/upload"), 1);
    live.stop().await;
}

#[tokio::test]
async fn viewer_tree_change_is_refused_before_sending() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "vera", &port, quick()).await;
    port.text("mine.tex", "x");
    for change in [
        TreeChange::NewDoc {
            path: "mine.tex".into(),
        },
        TreeChange::Move {
            from: NOTES.into(),
            to: "x.tex".into(),
        },
        TreeChange::Delete { path: MAIN.into() },
    ] {
        assert_eq!(live.change_tree(change), Err(TreeRefusal::NotAllowed));
    }
    assert_eq!(live.keep_away(MAIN), Ok(()));
    tokio::time::sleep(Duration::from_millis(200)).await;
    let writes = rig
        .mock
        .requests(&format!("/project/{}/", rig.mock.project_id()))
        .into_iter()
        .filter(|request| request.method != "GET")
        .count();
    assert_eq!(writes, 0);
    live.stop().await;
}

#[tokio::test]
async fn upload_queue_survives_restart() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    rig.mock.crash();
    eventually("the session is offline", || {
        port.seen()
            .states
            .last()
            .is_some_and(|state| matches!(state, LiveState::Offline { .. }))
    })
    .await;
    port.file("late.png", PNG);
    live.change_tree(TreeChange::Upload {
        path: "late.png".into(),
    })
    .unwrap();
    assert_eq!(
        port.queue()
            .iter()
            .filter(|queued| queued.is_waiting())
            .count(),
        1
    );
    live.stop().await;
    let queued = tokio::fs::read(live.journal_dir().join("tree-queue.json"))
        .await
        .unwrap();
    let queued: Value = serde_json::from_slice(&queued).unwrap();
    assert_eq!(queued["changes"][0]["change"]["path"], "late.png");
    drop(live);
    rig.mock.recover();
    let again = TreePort::new();
    again.file("late.png", PNG);
    let live = resume_as(&rig, "alice", &again, quick()).await;
    eventually("the upload lands after the restart", || {
        rig.mock.entity_id("late.png").is_some()
    })
    .await;
    queue_empty(&again).await;
    assert_eq!(requests(&rig, "POST", "/upload"), 1);
    live.stop().await;
}

#[tokio::test]
async fn uploads_are_paced_under_the_limits() {
    let defaults = SessionTuning::default();
    assert!(defaults.doc_limit < 30 && defaults.create_window >= Duration::from_secs(60));
    assert!(defaults.folder_limit < 60);
    assert!(defaults.upload_limit < 500 && defaults.upload_window >= Duration::from_secs(900));
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| {
        config.rate_limits.uploads_per_quarter_hour = 3;
    });
    let port = TreePort::new();
    let tuned = SessionTuning {
        upload_limit: 2,
        upload_window: Duration::from_millis(800),
        ..quick()
    };
    let live = live_as(&rig, "alice", &port, tuned).await;
    let started = Instant::now();
    for name in ["a.png", "b.png", "c.png"] {
        port.file(name, PNG);
        live.change_tree(TreeChange::Upload { path: name.into() })
            .unwrap();
    }
    eventually("two uploads land at once", || {
        requests(&rig, "POST", "/upload") >= 2
    })
    .await;
    assert!(started.elapsed() < Duration::from_millis(700));
    assert_eq!(requests(&rig, "POST", "/upload"), 2);
    queue_empty(&port).await;
    assert!(started.elapsed() >= Duration::from_millis(800));
    assert_eq!(requests(&rig, "POST", "/upload"), 3);
    live.stop().await;
}

#[tokio::test]
async fn a_lost_create_reply_is_reconciled_not_duplicated() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let route = format!("/project/{}/doc", rig.mock.project_id());
    rig.mock.plan_fault(Some("POST"), &route, Fault::LoseReply);
    port.text("lost.tex", "Kept text");
    live.change_tree(TreeChange::NewDoc {
        path: "lost.tex".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    eventually("the doc is filled from the room event", || {
        rig.mock
            .entity_id("lost.tex")
            .is_some_and(|id| rig.mock.doc_text(&id) == "Kept text")
    })
    .await;
    assert_eq!(requests(&rig, "POST", "/doc"), 1);
    live.stop().await;
}

#[tokio::test]
async fn a_lost_create_reply_with_no_room_event_asks_the_entity_list() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    rig.mock.hold_room_events();
    let route = format!("/project/{}/doc", rig.mock.project_id());
    rig.mock.plan_fault(Some("POST"), &route, Fault::LoseReply);
    port.text("quiet.tex", "Quiet");
    live.change_tree(TreeChange::NewDoc {
        path: "quiet.tex".into(),
    })
    .unwrap();
    eventually("the entity list is read", || {
        requests(&rig, "GET", "/entities") >= 1
    })
    .await;
    rig.mock.release_room_events();
    queue_empty(&port).await;
    assert_eq!(requests(&rig, "POST", "/doc"), 1);
    eventually("the doc is filled once its room event lands", || {
        rig.mock
            .entity_id("quiet.tex")
            .is_some_and(|id| rig.mock.doc_text(&id) == "Quiet")
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn rest_429_honours_retry_after() {
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| config.retry_after = Some(1));
    let port = TreePort::new();
    let tuned = SessionTuning {
        rate_floor: Duration::from_secs(10),
        ..quick()
    };
    let live = live_as(&rig, "alice", &port, tuned).await;
    let route = format!("/project/{}/upload", rig.mock.project_id());
    rig.mock.plan_fault(
        Some("POST"),
        &route,
        Fault::Reply(429, "Rate limit reached, please try again later".into()),
    );
    port.file("slow.png", PNG);
    let started = Instant::now();
    live.change_tree(TreeChange::Upload {
        path: "slow.png".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    let waited = started.elapsed();
    assert!(waited >= Duration::from_secs(1), "{waited:?}");
    assert!(waited < Duration::from_secs(5), "{waited:?}");
    assert_eq!(requests(&rig, "POST", "/upload"), 2);
    live.stop().await;
}

#[tokio::test]
async fn rest_429_without_retry_after_waits_the_floor() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let route = format!("/project/{}/doc", rig.mock.project_id());
    rig.mock.plan_fault(
        Some("POST"),
        &route,
        Fault::Reply(429, "Rate limit reached, please try again later".into()),
    );
    port.text("floor.tex", "x");
    let started = Instant::now();
    live.change_tree(TreeChange::NewDoc {
        path: "floor.tex".into(),
    })
    .unwrap();
    queue_empty(&port).await;
    assert!(started.elapsed() >= Duration::from_millis(300));
    assert_eq!(requests(&rig, "POST", "/doc"), 2);
    live.stop().await;
}

#[tokio::test]
async fn binary_length_mismatch_refetches() {
    let rig = Rig::start(project().file("figure.png", PNG)).await;
    rig.mock.configure(|config| config.download_length = true);
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let figure = EntityId(rig.mock.entity_id("figure.png").unwrap());
    let blob = format!("/project/{}/blob", rig.mock.project_id());
    rig.mock.plan_fault(Some("GET"), &blob, Fault::Truncate(3));
    let mut seen = Vec::new();
    let bytes = live
        .download(&figure, &mut |done, total| seen.push((done, total)))
        .await
        .unwrap();
    assert_eq!(bytes, PNG);
    assert_eq!(requests_under(&rig, "GET", "/blob"), 2);
    assert_eq!(
        seen.last(),
        Some(&(PNG.len() as u64, Some(PNG.len() as u64)))
    );
    rig.mock
        .plan_fault(Some("GET"), &blob, Fault::Reply(404, "Not Found".into()));
    let bytes = live.download(&figure, &mut |_, _| {}).await.unwrap();
    assert_eq!(bytes, PNG);
    assert_eq!(requests(&rig, "GET", &format!("/file/{}", figure.0)), 1);
    for _ in 0..2 {
        rig.mock.plan_fault(Some("GET"), &blob, Fault::Truncate(3));
    }
    let failed = live.download(&figure, &mut |_, _| {}).await;
    assert!(failed.is_err(), "{failed:?}");
    live.stop().await;
}

#[tokio::test]
async fn a_chunked_download_cut_short_is_fetched_again() {
    let rig = Rig::start(project().file("figure.png", PNG)).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let figure = EntityId(rig.mock.entity_id("figure.png").unwrap());
    let blob = format!("/project/{}/blob", rig.mock.project_id());
    rig.mock.plan_fault(Some("GET"), &blob, Fault::Truncate(3));
    let mut seen = Vec::new();
    let bytes = live
        .download(&figure, &mut |done, total| seen.push((done, total)))
        .await
        .unwrap();
    assert_eq!(bytes, PNG);
    assert_eq!(requests_under(&rig, "GET", "/blob"), 2);
    assert!(seen.iter().all(|(_, total)| total.is_none()), "{seen:?}");
    assert_eq!(seen.last(), Some(&(PNG.len() as u64, None)));
    live.stop().await;
}

#[tokio::test]
async fn a_coauthor_delete_hands_over_unsent_text_before_the_tree_change() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let mut tab = Tab::open(&live, NOTES);
    let notes = tab.doc.clone();
    eventually("the tab shows the joined text", || {
        tab.text(&live) == "Notes"
    })
    .await;
    rig.mock.hold_updates();
    tab.type_at(&live, 5, " mine");
    let (bob_rest, bob) = as_bob(&rig).await;
    bob_rest
        .delete(&bob, NodeKind::Doc, &EntityId(notes.0.clone()))
        .await
        .unwrap();
    eventually("notes is stopped", || {
        port.seen().stopped.iter().any(|(doc, _)| *doc == notes)
    })
    .await;
    let order: Vec<String> = port
        .seen()
        .order
        .iter()
        .filter(|entry| entry.ends_with(&notes.0))
        .cloned()
        .collect();
    assert_eq!(
        order,
        vec![
            format!("kept {}", notes.0),
            format!("removed {}", notes.0),
            format!("stopped {}", notes.0),
        ]
    );
    rig.mock.release_updates();
    live.stop().await;
}

#[tokio::test]
async fn restore_on_overleaf_recreates_from_kept_copy() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let mut tab = Tab::open(&live, NOTES);
    let notes = tab.doc.clone();
    eventually("the tab shows the joined text", || {
        tab.text(&live) == "Notes"
    })
    .await;
    rig.mock.hold_updates();
    tab.type_at(&live, 5, " mine");
    let (bob_rest, bob) = as_bob(&rig).await;
    bob_rest
        .delete(&bob, NodeKind::Doc, &EntityId(notes.0.clone()))
        .await
        .unwrap();
    eventually("the unsent text is kept", || {
        port.seen()
            .merged
            .iter()
            .any(|(doc, review)| *doc == notes && matches!(review, MergeReview::Kept { .. }))
    })
    .await;
    rig.mock.release_updates();
    let kept = port
        .seen()
        .merged
        .iter()
        .find_map(|(doc, review)| match review {
            MergeReview::Kept { text } if *doc == notes => Some(text.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(kept, "Notes mine");
    port.text(NOTES, &kept);
    live.change_tree(TreeChange::NewDoc { path: NOTES.into() })
        .unwrap();
    eventually("notes is back on the server", || {
        rig.mock
            .entity_id(NOTES)
            .is_some_and(|id| rig.mock.doc_text(&id) == "Notes mine")
    })
    .await;
    assert_ne!(rig.mock.entity_id(NOTES).unwrap(), notes.0);
    live.stop().await;
}

#[tokio::test]
async fn remove_entity_with_convert_flag_switches_session() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let tab = Tab::open(&live, NOTES);
    let old = tab.doc.clone();
    let (bob_rest, bob) = as_bob(&rig).await;
    let root = EntityId(rig.mock.root_folder_id());
    bob_rest
        .upload(&bob, &root, NOTES, b"bin\0ary")
        .await
        .unwrap();
    eventually("the doc became a file", || {
        path_of(&live, NOTES) == Some(NodeKind::File)
    })
    .await;
    assert!(live.open(NOTES, Arc::new(|_| {})).is_none());
    assert!(port
        .seen()
        .stopped
        .contains(&(old.clone(), DocStopReason::Removed)));
    assert!(!port
        .seen()
        .merged
        .iter()
        .any(|(doc, review)| *doc == old && matches!(review, MergeReview::Kept { .. })));
    let replaced = port.seen().trees.iter().flatten().any(|change| {
        matches!(change, PathChange::Replaced { from: NodeKind::Doc, to: NodeKind::File, path, .. } if path == NOTES)
    });
    assert!(replaced);
    bob_rest
        .upload(&bob, &root, NOTES, b"Back to text")
        .await
        .unwrap();
    eventually("the file became a doc", || {
        path_of(&live, NOTES) == Some(NodeKind::Doc)
    })
    .await;
    let opened = live.open(NOTES, Arc::new(|_| {})).unwrap();
    assert_ne!(opened.file_id, old.0);
    live.stop().await;
}

#[tokio::test]
async fn keep_on_overleaf_records_kept_away_and_is_not_recreated() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let notes = rig.mock.entity_id(NOTES).unwrap();
    live.keep_away(NOTES).unwrap();
    assert_eq!(path_of(&live, NOTES), None);
    assert_eq!(live.kept_away(), vec![NOTES.to_string()]);
    let (bob_rest, bob) = as_bob(&rig).await;
    bob_rest
        .rename(&bob, NodeKind::Doc, &EntityId(notes.clone()), "moved.tex")
        .await
        .unwrap();
    eventually("the kept-away path follows the rename", || {
        live.kept_away() == vec!["moved.tex".to_string()]
    })
    .await;
    assert_eq!(path_of(&live, "moved.tex"), None);
    live.stop().await;
    let manifest = tokio::fs::read(live.journal_dir().join("project.json"))
        .await
        .unwrap();
    let manifest: Value = serde_json::from_slice(&manifest).unwrap();
    assert_eq!(manifest["kept_away"], json!(["moved.tex"]));
    drop(live);
    let again = TreePort::new();
    let live = resume_as(&rig, "alice", &again, quick()).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(path_of(&live, "moved.tex"), None);
    assert_eq!(path_of(&live, MAIN), Some(NodeKind::Doc));
    assert_eq!(live.kept_away(), vec!["moved.tex".to_string()]);
    bob_rest
        .delete(&bob, NodeKind::Doc, &EntityId(notes))
        .await
        .unwrap();
    eventually("a deleted kept-away path is forgotten", || {
        live.kept_away().is_empty()
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn a_local_delete_waits_for_unsent_edits_then_is_one_call() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let mut tab = Tab::open(&live, NOTES);
    let notes = tab.doc.clone();
    eventually("the tab shows the joined text", || {
        tab.text(&live) == "Notes"
    })
    .await;
    tab.type_at(&live, 0, "Last words. ");
    live.change_tree(TreeChange::Delete { path: NOTES.into() })
        .unwrap();
    assert_eq!(path_of(&live, NOTES), None);
    queue_empty(&port).await;
    assert!(rig.mock.entity_id(NOTES).is_none());
    assert_eq!(requests(&rig, "DELETE", &format!("/doc/{}", notes.0)), 1);
    assert!(!rig.updates_for(&notes).is_empty(), "the edit was dropped");
    assert!(!port
        .seen()
        .merged
        .iter()
        .any(|(doc, review)| *doc == notes && matches!(review, MergeReview::Kept { .. })));
    live.stop().await;
}

#[tokio::test]
async fn a_folder_delete_is_one_call() {
    let rig = Rig::start(project()).await;
    let port = TreePort::new();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let sections = rig.mock.entity_id("sections").unwrap();
    live.change_tree(TreeChange::Delete {
        path: "sections".into(),
    })
    .unwrap();
    assert_eq!(path_of(&live, "sections/intro.tex"), None);
    queue_empty(&port).await;
    assert!(rig.mock.entity_id("sections/intro.tex").is_none());
    assert_eq!(requests_under(&rig, "DELETE", ""), 1);
    assert_eq!(requests(&rig, "DELETE", &format!("/folder/{sections}")), 1);
    live.stop().await;
}

fn recorded_events(frames: impl Iterator<Item = (bool, String)>) -> Vec<ServerEvent> {
    frames
        .filter(|(outgoing, _)| !outgoing)
        .filter_map(|(_, raw)| codec::decode(&raw).ok()?.into_event())
        .filter(|(name, _)| name != "joinProjectResponse")
        .map(|(name, args)| ServerEvent::from_wire(&name, &args))
        .collect()
}

fn recorded_join(frames: impl Iterator<Item = (bool, String)>) -> Value {
    frames
        .filter(|(outgoing, _)| !outgoing)
        .find_map(|(_, raw)| match codec::decode(&raw).ok()?.into_event()? {
            (name, mut args) if name == "joinProjectResponse" => Some(args.remove(0)),
            _ => None,
        })
        .unwrap()
}

fn trace_frames(trace: &Trace) -> impl Iterator<Item = (bool, String)> + '_ {
    trace
        .frames
        .iter()
        .map(|frame| (frame.outgoing, frame.raw.clone()))
}

struct Replay {
    state: State,
    port: Arc<TreePort>,
    _journal: Journal,
    _dir: tempfile::TempDir,
}

impl Replay {
    fn new(join: Value) -> Replay {
        let project = ProjectState::from_join(join).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let journal = Journal::open(
            dir.path(),
            "http://localhost:8080",
            "64f0c0ffee0123456789abcd",
            None,
        )
        .unwrap();
        let port = TreePort::new();
        let mut state = State::new(
            project,
            Account {
                user_id: "alice".into(),
                email: "alice@example.com".into(),
            },
            &journal,
            Arc::clone(&port) as Arc<dyn LivePort>,
        );
        state.announce();
        Replay {
            state,
            port,
            _journal: journal,
            _dir: dir,
        }
    }

    fn play(&mut self, events: Vec<ServerEvent>) {
        let now = std::time::Instant::now();
        for event in events {
            if let ServerEvent::Tree(event) = event {
                let changes = self.state.project.tree.apply(&event, now);
                self.state.tree_changed(changes);
            }
        }
        let changes = self.state.project.tree.flush();
        self.state.tree_changed(changes);
        let notices = std::mem::take(&mut self.state.notices);
        super::super::state::deliver(self.port.as_ref(), notices);
    }

    fn paths(&self) -> Vec<String> {
        self.state.project.tree.paths()
    }
}

#[test]
fn recorded_tree_events_replay_through_the_session() {
    let frames = || {
        probe_frames("upload-replace-and-convert", "websocket")
            .into_iter()
            .map(|frame| (frame.outgoing, frame.raw))
    };
    let mut replay = Replay::new(recorded_join(frames()));
    let main = replay.state.project.tree.id_at("main.tex").unwrap().clone();
    let laid = replay.state.change_tree(TreeChange::Move {
        from: "main.tex".into(),
        to: "thesis.tex".into(),
    });
    assert_eq!(laid, Ok(()));
    replay.play(recorded_events(frames()));
    let paths = replay.paths();
    assert!(paths.contains(&"thesis.tex".to_string()), "{paths:?}");
    assert!(!paths.contains(&"main.tex".to_string()), "{paths:?}");
    assert_eq!(replay.state.project.tree.id_at("thesis.tex"), Some(&main));
    assert!(
        !paths.iter().any(|path| path.starts_with("convert-probe")),
        "{paths:?}"
    );
    let kinds: Vec<String> = replay
        .port
        .seen()
        .trees
        .iter()
        .flatten()
        .map(|change| match change {
            PathChange::Added { kind, .. } => format!("added {kind:?}"),
            PathChange::Replaced { from, to, .. } => format!("replaced {from:?} with {to:?}"),
            PathChange::Moved { kind, .. } => format!("moved {kind:?}"),
            PathChange::Removed { kind, .. } => format!("removed {kind:?}"),
        })
        .collect();
    assert_eq!(
        kinds,
        vec![
            "moved Doc",
            "added Doc",
            "replaced Doc with File",
            "replaced File with Doc",
            "added File",
            "replaced File with File",
            "removed Doc",
            "removed File",
        ]
    );
    assert!(replay.port.seen().merged.is_empty());

    for name in ["rename-while-open", "delete-open-file"] {
        let recording = recordings()
            .into_iter()
            .find(|recording| recording.name == name)
            .unwrap();
        for trace in &recording.traces {
            let mut replay = Replay::new(recorded_join(trace_frames(trace)));
            let before = replay.state.project.tree.nodes().len();
            replay.play(recorded_events(trace_frames(trace)));
            let after = replay.state.project.tree.nodes();
            let doc = recording.summary["doc"]["name"].as_str();
            match name {
                "rename-while-open" => {
                    assert_eq!(after.len(), before, "{name} {}", trace.name);
                    if let Some(doc) = doc {
                        assert!(!replay.paths().iter().any(|path| path.ends_with(doc)));
                    }
                }
                _ => assert_eq!(after.len(), before - 1, "{name} {}", trace.name),
            }
        }
    }
}

#[test]
fn a_protocol_change_keeps_queued_moves_and_kept_away_hidden() {
    let frames = || {
        probe_frames("upload-replace-and-convert", "websocket")
            .into_iter()
            .map(|frame| (frame.outgoing, frame.raw))
    };
    let join = recorded_join(frames());
    let mut replay = Replay::new(join.clone());
    let paths = replay.paths();
    let doc = paths
        .iter()
        .find(|path| path.ends_with(".tex") && path.as_str() != "main.tex")
        .unwrap()
        .clone();
    replay
        .state
        .change_tree(TreeChange::Move {
            from: "main.tex".into(),
            to: "thesis.tex".into(),
        })
        .unwrap();
    replay.state.keep_away(&doc).unwrap();
    let mut changed = join;
    changed["protocolVersion"] = json!(3);
    changed["publicId"] = json!("P.after");
    assert_eq!(
        replay.state.rejoined(PublicId("P.after".into()), changed),
        Handshake::Joined
    );
    let paths = replay.paths();
    assert!(paths.contains(&"thesis.tex".to_string()), "{paths:?}");
    assert!(!paths.contains(&"main.tex".to_string()), "{paths:?}");
    assert!(!paths.contains(&doc), "{paths:?}");
    assert_eq!(replay.state.kept_away(), vec![doc]);
    let _ = WAIT;
}

#[tokio::test]
async fn gets_retry_twice_then_give_up() {
    let rig = Rig::start(project()).await;
    let (rest, bob) = as_bob(&rig).await;
    let route = format!("/project/{}/entities", rig.mock.project_id());
    for _ in 0..2 {
        rig.mock.plan_fault(Some("GET"), &route, Fault::LoseReply);
    }
    let listed = rest.entities(&bob).await.unwrap();
    assert!(listed.contains(&MAIN.to_string()), "{listed:?}");
    assert_eq!(requests(&rig, "GET", "/entities"), 3);
    for _ in 0..3 {
        rig.mock.plan_fault(Some("GET"), &route, Fault::LoseReply);
    }
    assert!(rest.entities(&bob).await.is_err());
    assert_eq!(requests(&rig, "GET", "/entities"), 6);
}
