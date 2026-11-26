use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use oleafly_online::client::Http;
use oleafly_online::live::doc::{DocError, Origin, OverleafDoc, Rejoin, ReviewOp};
use oleafly_online::live::format::{new_thread_id, Decision, FormatState};
use oleafly_online::live::join::{parse_join, JoinedDoc};
use oleafly_online::live::rest::{ProjectRest, ReviewError};
use oleafly_online::live::{SendMode, Tracking};
use oleafly_online::realtime::connection::{connect, Carrier, Connection};
use oleafly_online::realtime::events::{AppliedUpdate, DocId, PublicId, ServerEvent};
use oleafly_online::realtime::ProjectPage;
use oleafly_online::session::{self, SessionHandle};
use oleafly_ot::testing::{deletion, insertion};
use oleafly_ot::utf16_len;
use serde_json::{json, Value};

const AGENT: &str = concat!("Oleafly/", env!("CARGO_PKG_VERSION"), " gate");
const USAGE: &str = "usage: live_doc_gate --server <url> --project <id> [--carrier websocket|xhr-polling]\n\
The session cookie comes from GATE_COOKIE. Commands arrive on stdin as JSON lines and each gets one JSON line back.";
const TICK: Duration = Duration::from_millis(200);

#[derive(Default)]
struct Health {
    update_errors: Vec<String>,
    refusals: Vec<String>,
    drops: Vec<String>,
    unexpected: Vec<String>,
    gaps: usize,
    rejoins: Vec<String>,
    reconnects: usize,
}

impl Health {
    fn to_json(&self) -> Value {
        json!({
            "updateErrors": self.update_errors,
            "refusals": self.refusals,
            "drops": self.drops,
            "unexpected": self.unexpected,
            "gaps": self.gaps,
            "rejoins": self.rejoins,
            "reconnects": self.reconnects,
        })
    }
}

struct Gate {
    http: Http,
    session: SessionHandle,
    page: Arc<ProjectPage>,
    rest: ProjectRest,
    carriers: Vec<Carrier>,
    connection: Option<Connection>,
    own: Vec<PublicId>,
    docs: BTreeMap<String, OverleafDoc>,
    mode: SendMode,
    held: bool,
    deaf: bool,
    unheard: Vec<ServerEvent>,
    health: Health,
}

fn text_of(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn tracked_json(doc: &OverleafDoc) -> Value {
    match doc.format() {
        FormatState::ShareJs(ranges) => json!({
            "format": "sharejs-text-ot",
            "changes": ranges.changes().iter().map(|change| json!({
                "kind": format!("{:?}", change.kind),
                "at": change.at,
                "text": text_of(&change.text),
                "user": change.user,
            })).collect::<Vec<_>>(),
            "comments": ranges.comments().len(),
        }),
        FormatState::HistoryOt(raw) => json!({
            "format": "history-ot",
            "content": raw.content().unwrap_or_default(),
            "tracked": raw.tracked().iter().map(|range| json!({
                "pos": range.pos,
                "length": range.length,
                "type": range.tracking["type"],
                "user": range.tracking["userId"],
            })).collect::<Vec<_>>(),
            "comments": raw.comments().len(),
        }),
    }
}

fn state_json(id: &str, doc: &OverleafDoc) -> Value {
    json!({
        "doc": id,
        "text": doc.text(),
        "version": doc.version(),
        "settled": doc.is_settled(),
        "ranges": tracked_json(doc),
    })
}

fn review_json(doc: &OverleafDoc) -> Value {
    let review = doc.review();
    json!({
        "comments": review.comments.iter().map(|comment| json!({
            "thread": comment.thread,
            "ranges": comment.ranges,
            "quote": comment.quote,
            "resolved": comment.resolved,
        })).collect::<Vec<_>>(),
        "changes": review.changes.iter().map(|change| json!({
            "id": change.id,
            "kind": format!("{:?}", change.kind),
            "from": change.from,
            "to": change.to,
            "text": change.text,
            "user": change.user,
        })).collect::<Vec<_>>(),
    })
}

fn origin_of(command: &Value) -> Result<Option<Origin>, String> {
    match command["origin"].as_str() {
        None => Ok(None),
        Some("undo") => Ok(Some(Origin::Undo)),
        Some("redo") => Ok(Some(Origin::Redo)),
        Some("cut") => Ok(Some(Origin::Cut)),
        Some("paste") => Ok(Some(Origin::Paste)),
        Some(other) => Err(format!("unknown origin {other}")),
    }
}

async fn next_event(connection: &mut Option<Connection>) -> Option<ServerEvent> {
    match connection {
        Some(connection) => connection.next_event().await,
        None => std::future::pending().await,
    }
}

fn field<'a>(command: &'a Value, name: &str) -> Result<&'a str, String> {
    command[name]
        .as_str()
        .ok_or_else(|| format!("the command needs a \"{name}\""))
}

fn number(command: &Value, name: &str) -> Result<usize, String> {
    command[name]
        .as_u64()
        .map(|value| value as usize)
        .ok_or_else(|| format!("the command needs a number \"{name}\""))
}

impl Gate {
    fn public_id(&self) -> Option<PublicId> {
        self.connection
            .as_ref()
            .map(|connection| connection.public_id().clone())
    }

    async fn connect(&mut self) -> Result<Value, String> {
        let (connection, join) = connect(&self.http, &self.session, &self.page, &self.carriers)
            .await
            .map_err(|error| error.to_string())?;
        self.own.push(join.public_id.clone());
        let carrier = connection.carrier().wire_name();
        self.connection = Some(connection);
        Ok(
            json!({ "publicId": join.public_id, "carrier": carrier, "permissionsLevel": join.response["permissionsLevel"] }),
        )
    }

    async fn join(&self, doc: &str, from: Option<u64>) -> Result<JoinedDoc, String> {
        let connection = self.connection.as_ref().ok_or("not connected")?;
        let options = json!({ "encodeRanges": true, "supportsHistoryOT": true });
        let args = match from {
            Some(from) => vec![json!(doc), json!(from), options],
            None => vec![json!(doc), options],
        };
        let reply = connection
            .call("joinDoc", args)
            .await
            .map_err(|error| error.to_string())?;
        parse_join(&DocId(doc.to_string()), &reply).map_err(|failure| format!("{failure:?}"))
    }

    async fn open(&mut self, doc: &str) -> Result<Value, String> {
        let joined = self.join(doc, None).await?;
        let opened = OverleafDoc::joined(
            DocId(doc.to_string()),
            joined.version,
            joined.text,
            joined.format,
        );
        let state = state_json(doc, &opened);
        self.docs.insert(doc.to_string(), opened);
        Ok(state)
    }

    async fn rejoin(&mut self, id: &str) -> Result<(), String> {
        let version = self
            .docs
            .get(id)
            .map(OverleafDoc::version)
            .ok_or("not open")?;
        if let Ok(joined) = self.join(id, Some(version)).await {
            let own = self.own.clone();
            let doc = self.docs.get_mut(id).ok_or("not open")?;
            if doc.catch_up(&joined.updates, &own).is_ok() {
                return Ok(());
            }
        }
        let fresh = self.join(id, None).await?;
        let doc = self.docs.get_mut(id).ok_or("not open")?;
        let outcome = match doc.rejoin_fresh(fresh.version, fresh.text, fresh.format) {
            Rejoin::Clean(_) => "clean".to_string(),
            Rejoin::Merged(_) => "merged".to_string(),
            Rejoin::Conflict { mine, theirs } => {
                format!("conflict: mine {mine:?} theirs {theirs:?}")
            }
        };
        self.health.rejoins.push(format!("{id}: {outcome}"));
        Ok(())
    }

    async fn applied(&mut self, update: AppliedUpdate) {
        let own = self.own.clone();
        let id = update.doc.0.clone();
        let Some(doc) = self.docs.get_mut(&id) else {
            return;
        };
        match doc.applied(&update, &own) {
            Ok(_) => {}
            Err(DocError::Gap { .. }) => {
                self.health.gaps += 1;
                if let Err(error) = self.rejoin(&id).await {
                    self.health
                        .unexpected
                        .push(format!("rejoin after a gap: {error}"));
                }
            }
            Err(error) => self
                .health
                .unexpected
                .push(format!("{id}: {error} on {update:?}")),
        }
    }

    async fn event(&mut self, event: Option<ServerEvent>) {
        match event {
            None => {
                let reason = self
                    .connection
                    .take()
                    .and_then(|connection| connection.dropped());
                self.health.drops.push(format!("{reason:?}"));
            }
            Some(event) if self.deaf => self.unheard.push(event),
            Some(ServerEvent::Applied(update)) => self.applied(update).await,
            Some(ServerEvent::UpdateError { doc, message }) => {
                self.health.update_errors.push(format!("{doc}: {message}"));
            }
            Some(
                event @ (ServerEvent::Rejected(_)
                | ServerEvent::ForceDisconnect { .. }
                | ServerEvent::ReconnectGracefully),
            ) => {
                self.health.unexpected.push(format!("{event:?}"));
            }
            Some(_) => {}
        }
    }

    async fn pump(&mut self) {
        let Some(on) = self.public_id().filter(|_| !self.held) else {
            return;
        };
        let ids: Vec<String> = self.docs.keys().cloned().collect();
        for id in ids {
            let Some(doc) = self.docs.get_mut(&id) else {
                continue;
            };
            let next = doc.next_update(&on, &self.mode, Instant::now());
            drop(doc.take_shown());
            for dropped in doc.take_dropped() {
                self.health
                    .unexpected
                    .push(format!("{id}: dropped {dropped:?}"));
            }
            let update = match next {
                Ok(Some(update)) => update,
                Ok(None) => continue,
                Err(error) => {
                    self.health
                        .unexpected
                        .push(format!("{id}: the send gate said {error}"));
                    continue;
                }
            };
            let Some(connection) = &self.connection else {
                return;
            };
            if let Ok(reply) = connection
                .call("applyOtUpdate", vec![json!(id), update.payload()])
                .await
            {
                if reply.first().is_some_and(|error| !error.is_null()) {
                    self.health
                        .refusals
                        .push(format!("{id}: {reply:?} for {}", update.payload()));
                }
            }
        }
    }

    fn edit(&mut self, command: &Value, insert: bool) -> Result<Value, String> {
        let id = field(command, "doc")?;
        let doc = self.docs.get_mut(id).ok_or("not open")?;
        let total = utf16_len(doc.text());
        let at = number(command, "at")?.min(total);
        let op = if insert {
            insertion(total, at, field(command, "text")?)
        } else {
            deletion(total, at, number(command, "length")?.min(total - at))
        };
        let correction = doc
            .local_from(op, origin_of(command)?)
            .map_err(|error| error.to_string())?;
        Ok(json!({ "corrected": correction.is_some(), "text": doc.text() }))
    }

    fn open_doc(&mut self, command: &Value) -> Result<(String, &mut OverleafDoc), String> {
        let id = field(command, "doc")?.to_string();
        let doc = self.docs.get_mut(&id).ok_or("not open")?;
        Ok((id, doc))
    }

    async fn comment(&mut self, command: &Value) -> Result<Value, String> {
        let thread = match command["thread"].as_str() {
            Some(thread) => thread.to_string(),
            None => new_thread_id().map_err(|error| error.to_string())?,
        };
        let (from, to) = (number(command, "from")?, number(command, "to")?);
        let (_, doc) = self.open_doc(command)?;
        doc.queue_review(ReviewOp::Anchor {
            thread: thread.clone(),
            ranges: vec![(from, to)],
            ride: false,
        });
        self.pump().await;
        Ok(json!({ "thread": thread }))
    }

    async fn resolve(&mut self, command: &Value) -> Result<Value, String> {
        let thread = field(command, "thread")?.to_string();
        let resolved = command["resolved"].as_bool().unwrap_or(true);
        let (id, doc) = self.open_doc(command)?;
        if let FormatState::HistoryOt(_) = doc.format() {
            doc.queue_review(ReviewOp::Resolve { thread, resolved });
            self.pump().await;
            return Ok(json!({ "by": "op" }));
        }
        let doc = DocId(id);
        let call = if resolved {
            self.rest.resolve_thread(&self.session, &doc, &thread).await
        } else {
            self.rest.reopen_thread(&self.session, &doc, &thread).await
        };
        call.map_err(|error| error.to_string())?;
        Ok(json!({ "by": "rest" }))
    }

    async fn decide(&mut self, command: &Value) -> Result<Value, String> {
        let ids: Vec<String> = command["ids"]
            .as_array()
            .ok_or("the command needs \"ids\"")?
            .iter()
            .filter_map(|id| id.as_str().map(str::to_string))
            .collect();
        let decision = match field(command, "decision")? {
            "accept" => Decision::Accept,
            "reject" => Decision::Reject,
            other => return Err(format!("unknown decision {other}")),
        };
        let (id, doc) = self.open_doc(command)?;
        if matches!(doc.format(), FormatState::ShareJs(_)) && decision == Decision::Accept {
            let known: Option<Vec<String>> =
                ids.iter().map(|id| doc.server_change_id(id)).collect();
            let known = known.ok_or("a change id is not known yet: rejoin first")?;
            match self
                .rest
                .accept_changes(&self.session, &DocId(id.clone()), &known)
                .await
            {
                Ok(()) => {
                    let doc = self.docs.get_mut(&id).ok_or("not open")?;
                    doc.accept_locally(&known);
                    return Ok(json!({ "by": "rest" }));
                }
                Err(ReviewError::Absent) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        let (_, doc) = self.open_doc(command)?;
        let changes = doc.targets(&ids).ok_or("a change is not in this doc")?;
        doc.queue_review(ReviewOp::Decide { changes, decision });
        self.pump().await;
        Ok(json!({ "by": "op" }))
    }

    async fn threads(&self) -> Result<Value, String> {
        let threads = self
            .rest
            .threads(&self.session)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({
            "threads": threads.iter().map(|thread| json!({
                "id": thread.id,
                "messages": thread.messages.iter().map(|message| json!({
                    "id": message.id,
                    "content": message.content,
                    "user": message.user_id,
                })).collect::<Vec<_>>(),
                "resolved": thread.resolved.is_some(),
            })).collect::<Vec<_>>(),
        }))
    }

    async fn hear(&mut self) {
        self.deaf = false;
        for event in std::mem::take(&mut self.unheard) {
            self.event(Some(event)).await;
        }
    }

    async fn drop_mid_op(&mut self, sent: bool) -> Result<Value, String> {
        let on = self.public_id().ok_or("not connected")?;
        let ids: Vec<String> = self.docs.keys().cloned().collect();
        let mut queued = 0;
        for id in &ids {
            let Some(doc) = self.docs.get_mut(id) else {
                continue;
            };
            if let Ok(Some(update)) = doc.next_update(&on, &self.mode, Instant::now()) {
                queued += 1;
                if let (true, Some(connection)) = (sent, &self.connection) {
                    connection.emit("applyOtUpdate", vec![json!(id), update.payload()]);
                }
            }
        }
        if let Some(connection) = self.connection.take() {
            connection.close().await;
        }
        self.unheard.clear();
        self.health.reconnects += 1;
        let joined = self.connect().await?;
        for id in &ids {
            self.rejoin(id).await?;
        }
        self.pump().await;
        Ok(json!({ "queued": queued, "rejoined": joined }))
    }

    async fn settle(&mut self, quiet: Duration, limit: Duration) -> Value {
        let started = Instant::now();
        while started.elapsed() < limit {
            self.pump().await;
            match tokio::time::timeout(quiet, next_event(&mut self.connection)).await {
                Ok(event) => self.event(event).await,
                Err(_) if self.docs.values().all(OverleafDoc::is_settled) => {
                    return json!({ "settled": true, "docs": self.states() });
                }
                Err(_) => {}
            }
        }
        json!({ "settled": false, "docs": self.states() })
    }

    fn states(&self) -> Vec<Value> {
        self.docs
            .iter()
            .map(|(id, doc)| state_json(id, doc))
            .collect()
    }

    async fn command(&mut self, line: &str) -> Result<Value, String> {
        let command: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
        match field(&command, "cmd")? {
            "connect" => self.connect().await,
            "open" => self.open(field(&command, "doc")?).await,
            "type" => self.edit(&command, true),
            "delete" => self.edit(&command, false),
            "suggest" => {
                self.mode = SendMode::Suggest(Tracking {
                    user_id: self.session.user_id().to_string(),
                    ts: field(&command, "ts")?.to_string(),
                });
                Ok(json!({}))
            }
            "review" => {
                self.mode = SendMode::Review(Tracking {
                    user_id: self.session.user_id().to_string(),
                    ts: field(&command, "ts")?.to_string(),
                });
                Ok(json!({}))
            }
            "edit" => {
                self.mode = SendMode::Edit;
                Ok(json!({}))
            }
            "comment" => self.comment(&command).await,
            "resolve" => self.resolve(&command).await,
            "decide" => self.decide(&command).await,
            "threads" => self.threads().await,
            "ranges" => {
                let (_, doc) = self.open_doc(&command)?;
                Ok(review_json(doc))
            }
            "hold" => {
                self.held = true;
                Ok(json!({}))
            }
            "release" => {
                self.held = false;
                self.pump().await;
                Ok(json!({}))
            }
            "deafen" => {
                self.deaf = true;
                Ok(json!({}))
            }
            "hear" => {
                self.hear().await;
                self.pump().await;
                Ok(json!({}))
            }
            "drop" => {
                self.drop_mid_op(command["sent"].as_bool().unwrap_or(true))
                    .await
            }
            "settle" => {
                let quiet = Duration::from_millis(command["quietMs"].as_u64().unwrap_or(2_000));
                let limit = Duration::from_millis(command["limitMs"].as_u64().unwrap_or(60_000));
                Ok(self.settle(quiet, limit).await)
            }
            "state" => Ok(json!({ "docs": self.states() })),
            "health" => Ok(
                json!({ "health": self.health.to_json(), "connected": self.connection.is_some(), "own": self.own }),
            ),
            other => Err(format!("unknown command {other}")),
        }
    }
}

fn options() -> Result<(String, String, Vec<Carrier>), String> {
    let mut args = std::env::args().skip(1);
    let (mut server, mut project) = (None, None);
    let mut carriers = vec![Carrier::WebSocket, Carrier::XhrPolling];
    while let Some(flag) = args.next() {
        let value = args.next().ok_or_else(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--server" => server = Some(value),
            "--project" => project = Some(value),
            "--carrier" if value == "websocket" => carriers = vec![Carrier::WebSocket],
            "--carrier" if value == "xhr-polling" => carriers = vec![Carrier::XhrPolling],
            other => return Err(format!("unknown flag {other} {value}")),
        }
    }
    let server = session::normalize_server(server.as_deref())
        .map_err(|error| format!("{:?}", error.kind))?;
    Ok((server, project.ok_or("--project is required")?, carriers))
}

async fn start() -> Result<Gate, String> {
    let (server, project, carriers) = options()?;
    let cookie = std::env::var("GATE_COOKIE").map_err(|_| "GATE_COOKIE is not set")?;
    let http = Http::new(&server, AGENT).map_err(|error| format!("{:?}", error.kind))?;
    let signed_in = session::session_from_cookie(&http, cookie, "gate")
        .await
        .map_err(|error| format!("the dashboard refused the session: {:?}", error.kind))?;
    let session = SessionHandle::new(&server, signed_in, None);
    let page = Arc::new(
        ProjectPage::load(&http, &session, &project, false)
            .await
            .map_err(|error| format!("the editor page failed: {:?}", error.kind))?,
    );
    let rest = ProjectRest::new(http.clone(), Arc::clone(&page), &project);
    Ok(Gate {
        http,
        session,
        page,
        rest,
        carriers,
        connection: None,
        own: Vec::new(),
        docs: BTreeMap::new(),
        mode: SendMode::Edit,
        held: false,
        deaf: false,
        unheard: Vec::new(),
        health: Health::default(),
    })
}

fn reply(id: &Value, outcome: Result<Value, String>) {
    let line = match outcome {
        Ok(result) => json!({ "id": id, "ok": true, "result": result }),
        Err(error) => json!({ "id": id, "ok": false, "error": error }),
    };
    println!("{line}");
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mut gate = match start().await {
        Ok(gate) => gate,
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            std::process::exit(1);
        }
    };
    let (lines, mut incoming) = tokio::sync::mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lines().map_while(Result::ok) {
            if lines.send(line).is_err() {
                return;
            }
        }
    });
    println!(
        "{}",
        json!({ "ready": true, "user": gate.session.user_id() })
    );
    let mut tick = tokio::time::interval(TICK);
    loop {
        tokio::select! {
            line = incoming.recv() => {
                let Some(line) = line else {
                    break;
                };
                let id = serde_json::from_str::<Value>(&line).map(|command| command["id"].clone()).unwrap_or(Value::Null);
                let outcome = gate.command(&line).await;
                reply(&id, outcome);
            }
            event = next_event(&mut gate.connection) => gate.event(event).await,
            _ = tick.tick() => gate.pump().await,
        }
    }
    if let Some(connection) = gate.connection.take() {
        connection.close().await;
    }
}
