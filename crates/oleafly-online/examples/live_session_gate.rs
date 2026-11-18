use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use oleafly_online::client::Http;
use oleafly_online::live::journal::Journal;
use oleafly_online::live::rest::TreeRest;
use oleafly_online::live::session::{
    DocStopReason, LivePeer, LivePort, LiveState, MergeReview, OverleafSession, SessionConfig,
    SessionTuning,
};
use oleafly_online::live::tree_queue::{LocalFile, TreeChange};
use oleafly_online::realtime::connection::Carrier;
use oleafly_online::realtime::events::{DocId, EntityId, ProjectEvent, PublicId};
use oleafly_online::realtime::project::Role;
use oleafly_online::realtime::tree::{NodeKind, OverleafNode, PathChange};
use oleafly_online::realtime::ProjectPage;
use oleafly_online::session::{self, SessionHandle};
use oleafly_ot::testing::insertion;
use oleafly_ot::{utf16_len, DocSink};
use serde_json::{json, Value};

const AGENT: &str = "Oleafly/live-session-gate";
const POLL: Duration = Duration::from_millis(100);
const TYPE_EVERY: Duration = Duration::from_millis(400);
const WATCH_AFTER: Duration = Duration::from_secs(8);
const SETTLE: Duration = Duration::from_secs(30);
const CHANGE_WAIT: Duration = Duration::from_secs(30);
const PNG: &[u8] = b"\x89PNG\r\n\x1a\ngate";
const USAGE: &str = "usage: live_session_gate --server <url> --project <id> --scenario drain|idle|tree [--doc <path>] [--seconds N] [--rest N]
The session cookie comes from GATE_COOKIE, and for the tree scenario a coauthor's from GATE_BOB_COOKIE. drain and idle need --doc. Each line printed is one JSON event with the milliseconds since start.";

struct Printer {
    started: Instant,
    last: Mutex<Option<LiveState>>,
    texts: Mutex<BTreeSet<String>>,
    disk: Mutex<BTreeMap<String, String>>,
    files: Mutex<BTreeMap<String, Vec<u8>>>,
    changes: Mutex<Vec<String>>,
}

impl Printer {
    fn new() -> Printer {
        Printer {
            started: Instant::now(),
            last: Mutex::new(None),
            texts: Mutex::new(BTreeSet::new()),
            disk: Mutex::new(BTreeMap::new()),
            files: Mutex::new(BTreeMap::new()),
            changes: Mutex::new(Vec::new()),
        }
    }

    fn put_text(&self, path: &str, text: &str) {
        self.disk
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(path.to_string(), text.to_string());
    }

    fn put_file(&self, path: &str, bytes: &[u8]) {
        self.files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(path.to_string(), bytes.to_vec());
    }

    fn saw_change(&self, kind: &str) -> bool {
        self.changes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .any(|change| change.starts_with(kind))
    }

    fn say(&self, event: Value) {
        let ms = u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX);
        println!("{}", json!({ "ms": ms, "event": event }));
    }

    fn has_text(&self, doc: &DocId) -> bool {
        self.texts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&doc.0)
    }

    fn last(&self) -> Option<LiveState> {
        self.last
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl LivePort for Printer {
    fn state(&self, state: LiveState) {
        self.say(json!({ "state": format!("{state:?}") }));
        *self.last.lock().unwrap_or_else(PoisonError::into_inner) = Some(state);
    }

    fn role(&self, role: Role, tracking: bool) {
        self.say(json!({ "role": format!("{role:?}"), "tracking": tracking }));
    }

    fn texts_changed(&self, docs: Vec<DocId>) {
        self.texts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend(docs.into_iter().map(|doc| doc.0));
    }

    fn tree_changed(&self, changes: Vec<PathChange>) {
        let described: Vec<String> = changes.iter().map(|change| format!("{change:?}")).collect();
        self.say(json!({ "tree": described }));
        self.changes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend(described);
    }

    fn peer(&self, _peer: LivePeer) {}

    fn peer_left(&self, _id: &PublicId) {}

    fn doc_stopped(&self, doc: &DocId, reason: DocStopReason) {
        self.say(json!({ "stopped": doc.0, "reason": format!("{reason:?}") }));
    }

    fn project_event(&self, _event: ProjectEvent) {}

    fn merged(&self, doc: &DocId, review: MergeReview) {
        self.say(json!({ "merged": doc.0, "review": format!("{review:?}") }));
    }

    fn journal_failed(&self, reason: Option<String>) {
        self.say(json!({ "journal": reason }));
    }

    fn disk_text(&self, path: &str) -> Option<String> {
        self.disk
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(path)
            .cloned()
    }

    fn local_file(&self, path: &str) -> Option<LocalFile> {
        let bytes = self
            .files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(path)
            .cloned()?;
        Some(LocalFile {
            bytes,
            tag: "gate".to_string(),
        })
    }

    fn maintenance(&self, message: &str, delay: Duration) {
        let delay = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX);
        self.say(json!({ "maintenance": message, "delayMs": delay }));
    }

    fn slow_ack(&self, waiting: bool) {
        self.say(json!({ "slowAck": waiting }));
    }

    fn doc_unsteady(&self, doc: &DocId) {
        self.say(json!({ "unsteady": doc.0 }));
    }
}

struct Options {
    server: String,
    project: String,
    doc: Option<String>,
    scenario: String,
    seconds: u64,
    rest: u64,
}

fn options() -> Result<Options, String> {
    let mut args = std::env::args().skip(1);
    let (mut server, mut project, mut doc, mut scenario) = (None, None, None, None);
    let (mut seconds, mut rest) = (12, 20);
    while let Some(flag) = args.next() {
        let value = args.next().ok_or_else(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--server" => server = Some(value),
            "--project" => project = Some(value),
            "--doc" => doc = Some(value),
            "--scenario" => scenario = Some(value),
            "--seconds" => seconds = value.parse().map_err(|_| "--seconds is a number")?,
            "--rest" => rest = value.parse().map_err(|_| "--rest is a number")?,
            other => return Err(format!("unknown flag {other} {value}")),
        }
    }
    let server = session::normalize_server(server.as_deref())
        .map_err(|error| format!("{:?}", error.kind))?;
    Ok(Options {
        server,
        project: project.ok_or("--project is required")?,
        doc,
        scenario: scenario.ok_or("--scenario is required")?,
        seconds,
        rest,
    })
}

async fn signed_in(options: &Options, cookie: String) -> Result<(Http, SessionHandle), String> {
    let http = Http::new(&options.server, AGENT).map_err(|error| format!("{:?}", error.kind))?;
    let signed_in = session::session_from_cookie(&http, cookie, "gate")
        .await
        .map_err(|error| format!("the dashboard refused the session: {:?}", error.kind))?;
    let handle = SessionHandle::new(&options.server, signed_in, None);
    Ok((http, handle))
}

async fn start(
    options: &Options,
    printer: &Arc<Printer>,
    data: &std::path::Path,
    cookie: String,
) -> Result<Arc<OverleafSession>, String> {
    let (http, handle) = signed_in(options, cookie).await?;
    let journal = Journal::open(data, &options.server, &options.project, None)
        .map_err(|error| format!("the journal failed: {error:?}"))?;
    let mut tuning = SessionTuning::default();
    if options.scenario == "idle" {
        tuning.idle_after = Duration::from_secs(options.seconds);
    }
    let config = SessionConfig {
        http,
        session: handle,
        project_id: options.project.clone(),
        carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
        tuning,
        seeds: Vec::new(),
    };
    let port = Arc::clone(printer) as Arc<dyn LivePort>;
    OverleafSession::start(config, port, journal)
        .await
        .map_err(|error| format!("the start failed: {:?}", error.kind))
}

async fn until(what: &str, limit: Duration, mut check: impl FnMut() -> bool) -> Result<(), String> {
    let started = Instant::now();
    while !check() {
        if started.elapsed() > limit {
            return Err(format!("timed out waiting until {what}"));
        }
        tokio::time::sleep(POLL).await;
    }
    Ok(())
}

fn is_online(printer: &Printer) -> bool {
    matches!(printer.last(), Some(LiveState::Online { .. }))
}

fn type_dot(live: &OverleafSession, doc: &DocId) -> Result<(), String> {
    live.local_edit_with(doc, |text| {
        let end = utf16_len(text);
        Some(insertion(end, end, "."))
    })
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn watch_link(live: &OverleafSession, printer: &Printer, seen: &mut Option<String>) {
    let now = live.details().public_id;
    if now != *seen {
        printer.say(json!({ "publicId": now }));
        seen.clone_from(&now);
    }
}

async fn drain(
    live: &OverleafSession,
    printer: &Printer,
    doc: &DocId,
    seconds: u64,
) -> Result<(), String> {
    let mut seen = None;
    watch_link(live, printer, &mut seen);
    printer.say(json!({ "ready": true, "typingSeconds": seconds }));
    let typing = Instant::now();
    let mut next_type = Instant::now();
    while typing.elapsed() < Duration::from_secs(seconds) {
        if Instant::now() >= next_type {
            type_dot(live, doc)?;
            next_type += TYPE_EVERY;
        }
        watch_link(live, printer, &mut seen);
        tokio::time::sleep(POLL).await;
    }
    printer.say(json!({ "typing": "stopped" }));
    let watching = Instant::now();
    while watching.elapsed() < WATCH_AFTER {
        watch_link(live, printer, &mut seen);
        tokio::time::sleep(POLL).await;
    }
    Ok(())
}

async fn idle(
    live: &OverleafSession,
    printer: &Printer,
    doc: &DocId,
    options: &Options,
) -> Result<(), String> {
    live.set_focused(false);
    printer.say(json!({ "ready": true, "idleAfterSeconds": options.seconds }));
    let limit = Duration::from_secs(options.seconds + 30);
    until("the session idles", limit, || {
        printer.last() == Some(LiveState::Idle)
    })
    .await?;
    printer.say(json!({ "resting": options.rest }));
    tokio::time::sleep(Duration::from_secs(options.rest)).await;
    live.set_focused(true);
    until("the session is back", SETTLE, || is_online(printer)).await?;
    type_dot(live, doc)
}

fn cookie(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}

fn paths(nodes: &[OverleafNode]) -> BTreeMap<String, OverleafNode> {
    let by_id: BTreeMap<&str, &OverleafNode> = nodes
        .iter()
        .map(|node| (node.id.0.as_str(), node))
        .collect();
    let mut placed = BTreeMap::new();
    for node in nodes.iter().filter(|node| node.parent.is_some()) {
        let mut names = vec![node.name.as_str()];
        let mut at = node.parent.as_ref();
        while let Some(parent) = at.and_then(|id| by_id.get(id.0.as_str())) {
            if parent.parent.is_none() {
                break;
            }
            names.push(parent.name.as_str());
            at = parent.parent.as_ref();
        }
        names.reverse();
        placed.insert(names.join("/"), node.clone());
    }
    placed
}

fn node_at(live: &OverleafSession, path: &str) -> Option<OverleafNode> {
    paths(&live.nodes()).remove(path)
}

fn has(live: &OverleafSession, path: &str) -> bool {
    node_at(live, path).is_some()
}

struct Checks<'a> {
    printer: &'a Printer,
    passed: usize,
    failed: Vec<String>,
}

impl Checks<'_> {
    fn record(&mut self, name: &str, ok: bool) {
        self.printer.say(json!({ "check": name, "ok": ok }));
        if ok {
            self.passed += 1;
        } else {
            self.failed.push(name.to_string());
        }
    }

    async fn wait(&mut self, name: &str, check: impl FnMut() -> bool) {
        let ok = until(name, CHANGE_WAIT, check).await.is_ok();
        self.record(name, ok);
    }
}

fn changed(live: &OverleafSession, change: TreeChange) -> Result<(), String> {
    live.change_tree(change)
        .map_err(|refusal| format!("the change was refused: {refusal:?}"))
}

async fn tree(live: &OverleafSession, printer: &Printer, options: &Options) -> Result<(), String> {
    let bob_cookie = cookie("GATE_BOB_COOKIE")?;
    let bob_printer = Arc::new(Printer::new());
    let bob_data = tempfile::tempdir().map_err(|error| error.to_string())?;
    let bob = start(options, &bob_printer, bob_data.path(), bob_cookie.clone()).await?;
    until("bob is online", SETTLE, || is_online(&bob_printer)).await?;
    let (http, bob_handle) = signed_in(options, bob_cookie).await?;
    let page = ProjectPage::load(&http, &bob_handle, &options.project, false)
        .await
        .map_err(|error| format!("bob's project page failed: {:?}", error.kind))?;
    let rest = TreeRest::new(http, Arc::new(page), &options.project);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let dir = format!("gate-{stamp}");
    let mut checks = Checks {
        printer,
        passed: 0,
        failed: Vec::new(),
    };

    changed(live, TreeChange::NewFolder { path: dir.clone() })?;
    checks
        .wait("a new folder reaches the server", || has(&bob, &dir))
        .await;
    let doc_path = format!("{dir}/new.tex");
    printer.put_text(&doc_path, "Gate text\n");
    changed(
        live,
        TreeChange::NewDoc {
            path: doc_path.clone(),
        },
    )?;
    checks
        .wait("a new doc reaches the server", || has(&bob, &doc_path))
        .await;
    if let Some(node) = node_at(&bob, &doc_path) {
        let ignore: DocSink = Arc::new(|_| {});
        let _ = bob.open(&doc_path, ignore);
        let doc = DocId(node.id.0);
        checks
            .wait("the new doc is filled with its text", || {
                bob.text(&doc).as_deref() == Some("Gate text\n")
            })
            .await;
    }
    let png_path = format!("{dir}/plot.png");
    printer.put_file(&png_path, PNG);
    changed(
        live,
        TreeChange::Upload {
            path: png_path.clone(),
        },
    )?;
    checks
        .wait("an upload reaches the server with a hash", || {
            node_at(&bob, &png_path).is_some_and(|node| node.hash.is_some())
        })
        .await;
    if let Some(node) = node_at(&bob, &png_path) {
        let fetched = bob.download(&node.id, &mut |_, _| {}).await;
        checks.record(
            "the upload downloads byte for byte",
            matches!(&fetched, Ok(bytes) if bytes == PNG),
        );
    }
    let renamed = format!("{dir}/renamed.tex");
    changed(
        live,
        TreeChange::Move {
            from: doc_path.clone(),
            to: renamed.clone(),
        },
    )?;
    checks
        .wait("a rename reaches the server", || {
            has(&bob, &renamed) && !has(&bob, &doc_path)
        })
        .await;
    changed(
        live,
        TreeChange::Delete {
            path: png_path.clone(),
        },
    )?;
    checks
        .wait("a delete reaches the server", || !has(&bob, &png_path))
        .await;

    let folder: EntityId = node_at(&bob, &dir)
        .map(|node| node.id)
        .ok_or("the gate folder is not on the server")?;
    let bob_doc = rest
        .create_doc(&bob_handle, &folder, "bob.tex")
        .await
        .map_err(|error| format!("bob's new doc failed: {error:?}"))?;
    let bob_doc_path = format!("{dir}/bob.tex");
    checks
        .wait("a coauthor's new doc shows in the tree", || {
            has(live, &bob_doc_path)
        })
        .await;
    checks
        .wait("a coauthor's new doc is joined", || {
            printer.has_text(&DocId(bob_doc.0.clone()))
        })
        .await;
    let big: Vec<u8> = PNG
        .iter()
        .copied()
        .chain(std::iter::repeat_n(7u8, 1536 * 1024))
        .collect();
    let uploaded = rest
        .upload(&bob_handle, &folder, "scan.png", &big)
        .await
        .map_err(|error| format!("bob's upload failed: {error:?}"))?;
    let scan = format!("{dir}/scan.png");
    checks
        .wait("a coauthor's upload shows in the tree", || has(live, &scan))
        .await;
    let mut steps = 0_u32;
    let mut length = None;
    let fetched = live
        .download(&uploaded.id, &mut |_, total| {
            steps += 1;
            length = total;
        })
        .await;
    printer.say(json!({ "downloadSteps": steps, "contentLength": length }));
    checks.record(
        "a big download arrives byte for byte",
        matches!(&fetched, Ok(bytes) if *bytes == big),
    );
    checks.record(
        "a big download says its length",
        length == Some(big.len() as u64),
    );
    let raw = Http::new(&options.server, AGENT).map_err(|error| format!("{:?}", error.kind))?;
    let routes = [
        format!(
            "/project/{}/blob/{}?fallback={}",
            options.project,
            uploaded.hash.clone().unwrap_or_default(),
            uploaded.id.0
        ),
        format!("/project/{}/file/{}", options.project, uploaded.id.0),
    ];
    for route in routes {
        let answer = raw.get(&route, &bob_handle.cookie()).send().await;
        let headers = answer.as_ref().ok().map(|response| {
            let header = |name: &str| {
                response
                    .headers()
                    .get(name)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string)
            };
            json!({
                "status": response.status().as_u16(),
                "contentLength": header("content-length"),
                "transferEncoding": header("transfer-encoding"),
                "contentEncoding": header("content-encoding"),
                "contentType": header("content-type"),
            })
        });
        printer.say(json!({ "route": route.split('?').next(), "headers": headers }));
    }
    rest.rename(&bob_handle, NodeKind::Doc, &bob_doc, "bob2.tex")
        .await
        .map_err(|error| format!("bob's rename failed: {error:?}"))?;
    let bob_renamed = format!("{dir}/bob2.tex");
    checks
        .wait("a coauthor's rename shows in the tree", || {
            has(live, &bob_renamed) && !has(live, &bob_doc_path)
        })
        .await;
    rest.upload(&bob_handle, &folder, "renamed.tex", b"now\0binary")
        .await
        .map_err(|error| format!("bob's replacing upload failed: {error:?}"))?;
    checks
        .wait("a doc replaced by a file is reported as replaced", || {
            printer.saw_change("Replaced")
        })
        .await;
    rest.delete(&bob_handle, NodeKind::Folder, &folder)
        .await
        .map_err(|error| format!("bob's folder delete failed: {error:?}"))?;
    checks
        .wait(
            "a coauthor's folder delete removes it from the tree",
            || !has(live, &dir) && !has(live, &scan),
        )
        .await;
    checks.record("nothing is left in the queue", live.tree_queue().is_empty());
    bob.stop().await;
    printer.say(json!({ "passed": checks.passed, "failed": checks.failed }));
    if checks.failed.is_empty() {
        Ok(())
    } else {
        Err(format!("{} tree checks failed", checks.failed.len()))
    }
}

async fn run(options: &Options) -> Result<(), String> {
    let printer = Arc::new(Printer::new());
    let data = tempfile::tempdir().map_err(|error| error.to_string())?;
    let live = start(options, &printer, data.path(), cookie("GATE_COOKIE")?).await?;
    until("the session is online", SETTLE, || is_online(&printer)).await?;
    if options.scenario == "tree" {
        let outcome = tree(&live, &printer, options).await;
        live.stop().await;
        return outcome;
    }
    let doc_path = options.doc.as_deref().ok_or("--doc is required")?;
    let ignore: DocSink = Arc::new(|_| {});
    let opened = live
        .open(doc_path, ignore)
        .ok_or("that doc is not in the project")?;
    let doc = DocId(opened.file_id);
    until("the doc is joined", SETTLE, || printer.has_text(&doc)).await?;
    match options.scenario.as_str() {
        "drain" => drain(&live, &printer, &doc, options.seconds).await?,
        "idle" => idle(&live, &printer, &doc, options).await?,
        other => return Err(format!("unknown scenario {other}")),
    }
    let settled = live.settle(SETTLE).await;
    printer.say(json!({ "settled": settled, "text": live.text(&doc), "details": live.details() }));
    live.stop().await;
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let options = match options() {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            std::process::exit(2);
        }
    };
    if let Err(error) = run(&options).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
