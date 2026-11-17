use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use oleafly_online::client::Http;
use oleafly_online::live::journal::Journal;
use oleafly_online::live::session::{
    DocStopReason, LivePeer, LivePort, LiveState, MergeReview, OverleafSession, SessionConfig,
    SessionTuning,
};
use oleafly_online::realtime::connection::Carrier;
use oleafly_online::realtime::events::{DocId, ProjectEvent, PublicId};
use oleafly_online::realtime::project::Role;
use oleafly_online::realtime::tree::PathChange;
use oleafly_online::session::{self, SessionHandle};
use oleafly_ot::testing::insertion;
use oleafly_ot::{utf16_len, DocSink};
use serde_json::{json, Value};

const AGENT: &str = "Oleafly/live-session-gate";
const POLL: Duration = Duration::from_millis(100);
const TYPE_EVERY: Duration = Duration::from_millis(400);
const WATCH_AFTER: Duration = Duration::from_secs(8);
const SETTLE: Duration = Duration::from_secs(30);
const USAGE: &str = "usage: live_session_gate --server <url> --project <id> --doc <path> --scenario drain|idle [--seconds N] [--rest N]
The session cookie comes from GATE_COOKIE. Each line printed is one JSON event with the milliseconds since start.";

struct Printer {
    started: Instant,
    last: Mutex<Option<LiveState>>,
    texts: Mutex<BTreeSet<String>>,
}

impl Printer {
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

    fn tree_changed(&self, _changes: Vec<PathChange>) {}

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

    fn disk_text(&self, _path: &str) -> Option<String> {
        None
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
    doc: String,
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
        doc: doc.ok_or("--doc is required")?,
        scenario: scenario.ok_or("--scenario is required")?,
        seconds,
        rest,
    })
}

async fn start(
    options: &Options,
    printer: &Arc<Printer>,
    data: &std::path::Path,
) -> Result<Arc<OverleafSession>, String> {
    let cookie = std::env::var("GATE_COOKIE").map_err(|_| "GATE_COOKIE is not set")?;
    let http = Http::new(&options.server, AGENT).map_err(|error| format!("{:?}", error.kind))?;
    let signed_in = session::session_from_cookie(&http, cookie, "gate")
        .await
        .map_err(|error| format!("the dashboard refused the session: {:?}", error.kind))?;
    let handle = SessionHandle::new(&options.server, signed_in, None);
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

async fn run(options: &Options) -> Result<(), String> {
    let printer = Arc::new(Printer {
        started: Instant::now(),
        last: Mutex::new(None),
        texts: Mutex::new(BTreeSet::new()),
    });
    let data = tempfile::tempdir().map_err(|error| error.to_string())?;
    let live = start(options, &printer, data.path()).await?;
    until("the session is online", SETTLE, || is_online(&printer)).await?;
    let ignore: DocSink = Arc::new(|_| {});
    let opened = live
        .open(&options.doc, ignore)
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
    let outcome = match options() {
        Ok(options) => run(&options).await,
        Err(error) => Err(error),
    };
    if let Err(error) = outcome {
        eprintln!("{error}\n{USAGE}");
        std::process::exit(1);
    }
}
