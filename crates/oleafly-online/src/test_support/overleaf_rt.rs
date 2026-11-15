use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::frames::Packet;

pub const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/overleaf-rt");

#[derive(Clone, Debug)]
pub struct Frame {
    pub t: u64,
    pub outgoing: bool,
    pub raw: String,
}

#[derive(Clone, Debug)]
pub struct Trace {
    pub name: String,
    pub user_id: String,
    pub scripted: bool,
    pub join_doc_type: Option<String>,
    pub frames: Vec<Frame>,
}

#[derive(Clone, Debug)]
pub struct Recording {
    pub name: String,
    pub dir: PathBuf,
    pub summary: Value,
    pub project: String,
    pub format: String,
    pub doc_id: String,
    pub converged: bool,
    pub traces: Vec<Trace>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DocEvent {
    Sent { v: u64, update: Value },
    Acked { v: u64 },
    Remote { v: u64, update: Value },
    Error { args: Vec<Value> },
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

impl Recording {
    pub fn load(dir: &Path) -> Recording {
        let summary: Value = serde_json::from_str(&read(&dir.join("scenario.json"))).unwrap();
        let text = |pointer: &str| {
            summary
                .pointer(pointer)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let traces = summary["participants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|participant| {
                let frames = read(&dir.join(participant["frames"].as_str().unwrap()))
                    .lines()
                    .filter(|line| !line.is_empty())
                    .map(|line| {
                        let frame: Value = serde_json::from_str(line).unwrap();
                        Frame {
                            t: frame["t"].as_u64().unwrap_or_default(),
                            outgoing: frame["dir"] == "out",
                            raw: frame["frame"].as_str().unwrap().to_string(),
                        }
                    })
                    .collect();
                Trace {
                    name: participant["name"].as_str().unwrap().to_string(),
                    user_id: participant["userId"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    scripted: participant["client"] == "scripted",
                    join_doc_type: participant["joinDocType"].as_str().map(str::to_string),
                    frames,
                }
            })
            .collect();
        Recording {
            name: text("/scenario"),
            dir: dir.to_path_buf(),
            project: text("/project/name"),
            format: text("/format"),
            doc_id: text("/doc/id"),
            converged: summary["converged"].as_bool().unwrap_or(false),
            summary,
            traces,
        }
    }

    pub fn trace(&self, name: &str) -> &Trace {
        self.traces
            .iter()
            .find(|trace| trace.name == name)
            .unwrap_or_else(|| panic!("{} has no participant {name}", self.name))
    }

    pub fn final_text(&self, participant: &str) -> Option<String> {
        let file = self.summary["finalText"].get(participant)?.as_str()?;
        Some(read(&self.dir.join(file)))
    }

    pub fn extra(&self, file: &str) -> Option<String> {
        std::fs::read_to_string(self.dir.join(file)).ok()
    }
}

pub fn probe(name: &str) -> Value {
    let path = Path::new(FIXTURES)
        .join("probes")
        .join(format!("{name}.json"));
    serde_json::from_str(&read(&path)).unwrap()
}

pub fn probe_frames(name: &str, transport: &str) -> Vec<Frame> {
    probe(name)["steps"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|step| step.get("socket"))
        .find(|socket| {
            socket
                .get("transport")
                .is_none_or(|found| found == transport)
        })
        .map(|socket| {
            socket["frames"]
                .as_array()
                .unwrap()
                .iter()
                .map(|frame| Frame {
                    t: frame["t"].as_u64().unwrap_or_default(),
                    outgoing: frame["dir"] == "out",
                    raw: frame["frame"].as_str().unwrap().to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn probe_event(name: &str, transport: &str, event: &str) -> Option<Vec<Value>> {
    probe_frames(name, transport)
        .iter()
        .filter(|frame| !frame.outgoing)
        .filter_map(|frame| Packet::parse(&frame.raw)?.event())
        .find(|(found, _)| found == event)
        .map(|(_, args)| args)
}

pub fn probe_http(name: &str, route_contains: &str) -> Value {
    probe(name)["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| {
            step.pointer("/request/route")
                .and_then(Value::as_str)
                .is_some_and(|route| route.contains(route_contains))
        })
        .cloned()
        .unwrap_or_else(|| panic!("probe {name} has no request to {route_contains}"))
}

pub fn recordings() -> Vec<Recording> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(FIXTURES)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.join("scenario.json").is_file())
        .collect();
    dirs.sort();
    dirs.iter().map(|dir| Recording::load(dir)).collect()
}

impl Trace {
    pub fn packets(&self) -> impl Iterator<Item = (bool, Packet)> + '_ {
        self.frames
            .iter()
            .filter_map(|frame| Packet::parse(&frame.raw).map(|packet| (frame.outgoing, packet)))
    }

    pub fn public_ids(&self) -> Vec<String> {
        self.packets()
            .filter(|(outgoing, _)| !outgoing)
            .filter_map(|(_, packet)| packet.event())
            .filter(|(name, _)| name == "joinProjectResponse")
            .filter_map(|(_, args)| args.first()?.get("publicId")?.as_str().map(str::to_string))
            .collect()
    }

    pub fn join_doc_replies(&self, doc_id: &str) -> Vec<Vec<Value>> {
        let mut asked = Vec::new();
        let mut replies = Vec::new();
        for (outgoing, packet) in self.packets() {
            if outgoing {
                if let Some((name, args)) = packet.event() {
                    if name == "joinDoc" && args.first().and_then(Value::as_str) == Some(doc_id) {
                        asked.extend(packet.id);
                    }
                }
            } else if packet.kind == 1 {
                asked.clear();
            } else if let Some((id, args)) = packet.ack() {
                if let Some(at) = asked.iter().position(|asked| *asked == id) {
                    asked.remove(at);
                    replies.push(args);
                }
            }
        }
        replies
    }

    pub fn last_session(&self, doc_id: &str) -> Option<(Vec<Value>, Vec<DocEvent>)> {
        let mut asked = Vec::new();
        let mut last = None;
        for (at, (outgoing, packet)) in self.packets().enumerate() {
            if outgoing {
                if let Some((name, args)) = packet.event() {
                    if name == "joinDoc" && args.first().and_then(Value::as_str) == Some(doc_id) {
                        asked.extend(packet.id);
                    }
                }
            } else if packet.kind == 1 {
                asked.clear();
            } else if let Some((id, args)) = packet.ack() {
                if let Some(index) = asked.iter().position(|asked| *asked == id) {
                    asked.remove(index);
                    last = Some((at, args));
                }
            }
        }
        let (at, reply) = last?;
        Some((reply, self.events_from(doc_id, at + 1)))
    }

    pub fn doc_events(&self, doc_id: &str) -> Vec<DocEvent> {
        self.events_from(doc_id, 0)
    }

    fn events_from(&self, doc_id: &str, skip: usize) -> Vec<DocEvent> {
        let mut events = Vec::new();
        for (outgoing, packet) in self.packets().skip(skip) {
            let Some((name, args)) = packet.event() else {
                continue;
            };
            let first = args.first().cloned().unwrap_or(Value::Null);
            match (outgoing, name.as_str()) {
                (true, "applyOtUpdate") if first.as_str() == Some(doc_id) => {
                    let update = args.get(1).cloned().unwrap_or(Value::Null);
                    events.push(DocEvent::Sent {
                        v: update["v"].as_u64().unwrap_or_default(),
                        update,
                    });
                }
                (false, "otUpdateApplied") if first["doc"].as_str() == Some(doc_id) => {
                    let v = first["v"].as_u64().unwrap_or_default();
                    if first.get("op").is_some() {
                        events.push(DocEvent::Remote { v, update: first });
                    } else {
                        events.push(DocEvent::Acked { v });
                    }
                }
                (false, "otUpdateError") => events.push(DocEvent::Error { args }),
                _ => {}
            }
        }
        events
    }
}

pub fn unpack_lines(lines: &[Value]) -> String {
    let joined = lines
        .iter()
        .map(|line| line.as_str().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n");
    let bytes: Vec<u8> = joined
        .chars()
        .map(|character| character as u32 as u8)
        .collect();
    String::from_utf8(bytes).unwrap_or(joined)
}

pub fn versions_reported(trace: &Trace, doc_id: &str) -> BTreeMap<u64, usize> {
    let mut seen = BTreeMap::new();
    for event in trace.doc_events(doc_id) {
        if let DocEvent::Acked { v } | DocEvent::Remote { v, .. } = event {
            *seen.entry(v).or_insert(0) += 1;
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::super::history_ot_text::TextOperation;
    use super::super::sharejs_text::{self, Op, Side};
    use super::*;

    fn sharejs_op(update: &Value) -> Op {
        sharejs_text::op_from_json(&update["op"]).unwrap()
    }

    fn snapshot(recording: &Recording, trace: &Trace) -> Option<(String, u64)> {
        snapshot_of(
            &trace
                .join_doc_replies(&recording.doc_id)
                .into_iter()
                .next()?,
        )
    }

    fn snapshot_of(reply: &[Value]) -> Option<(String, u64)> {
        let version = reply.get(2)?.as_u64()?;
        let text = match reply.get(1)? {
            Value::Array(lines) => unpack_lines(lines),
            Value::Object(raw) => raw.get("content")?.as_str()?.to_string(),
            _ => return None,
        };
        Some((text, version))
    }

    fn replay_sharejs_client(recording: &Recording, trace: &Trace) -> String {
        let (reply, events) = trace.last_session(&recording.doc_id).unwrap();
        let (text, mut version) = snapshot_of(&reply).unwrap();
        let mut text = sharejs_text::units(&text);
        let mut inflight: Option<Op> = None;
        for event in events {
            match event {
                DocEvent::Sent { v, update } => {
                    assert!(
                        inflight.is_none(),
                        "{}: {} sent while an op was in flight",
                        recording.name,
                        trace.name
                    );
                    assert_eq!(
                        v, version,
                        "{}: {} sent at the wrong version",
                        recording.name, trace.name
                    );
                    let op = sharejs_op(&update);
                    sharejs_text::apply_units(&mut text, &op).unwrap();
                    inflight = Some(op);
                }
                DocEvent::Acked { v } => {
                    assert!(
                        inflight.take().is_some(),
                        "{}: {} got an ack with nothing in flight",
                        recording.name,
                        trace.name
                    );
                    assert_eq!(v, version);
                    version += 1;
                }
                DocEvent::Remote { v, update } => {
                    assert_eq!(
                        v, version,
                        "{}: {} got a remote op out of order",
                        recording.name, trace.name
                    );
                    let mut remote = sharejs_op(&update);
                    if let Some(mine) = inflight.take() {
                        let (mine_after, remote_after) =
                            sharejs_text::transform_x(&mine, &remote).unwrap();
                        inflight = Some(mine_after);
                        remote = remote_after;
                    }
                    sharejs_text::apply_units(&mut text, &remote).unwrap();
                    version += 1;
                }
                DocEvent::Error { args } => {
                    panic!("{}: {} got an error {args:?}", recording.name, trace.name)
                }
            }
        }
        sharejs_text::text(&text)
    }

    fn replay_sharejs_server(recording: &Recording) -> (String, usize) {
        let web: Vec<&Trace> = recording
            .traces
            .iter()
            .filter(|trace| !trace.scripted)
            .collect();
        let (base, base_version) = web
            .iter()
            .filter_map(|trace| snapshot(recording, trace))
            .min_by_key(|(_, version)| *version)
            .unwrap();
        let mut observed: BTreeMap<u64, Op> = BTreeMap::new();
        let mut own = Vec::new();
        for trace in &web {
            let mut sent = Vec::new();
            for event in trace.doc_events(&recording.doc_id) {
                match event {
                    DocEvent::Remote { v, update } => {
                        let op = sharejs_op(&update);
                        if let Some(previous) = observed.insert(v, op.clone()) {
                            assert_eq!(
                                previous, op,
                                "{}: two clients saw different ops at v{v}",
                                recording.name
                            );
                        }
                    }
                    DocEvent::Sent { v, update } => sent.push((v, sharejs_op(&update))),
                    DocEvent::Acked { v } => {
                        let (sent_at, op) = sent.remove(0);
                        own.push((v, sent_at, op));
                    }
                    DocEvent::Error { .. } => {}
                }
            }
        }
        own.sort_by_key(|(applied, _, _)| *applied);
        let mut log = observed.clone();
        let mut compared = 0;
        for (applied, sent_at, op) in own {
            let mut transformed = op;
            for v in sent_at..applied {
                let concurrent = log
                    .get(&v)
                    .unwrap_or_else(|| panic!("{}: no op known at v{v}", recording.name));
                transformed =
                    sharejs_text::transform(&transformed, concurrent, Side::Left).unwrap();
            }
            match observed.get(&applied) {
                Some(seen) => {
                    assert_eq!(
                        &transformed, seen,
                        "{}: the server transformed v{applied} differently",
                        recording.name
                    );
                    if applied > sent_at {
                        compared += 1;
                    }
                }
                None => {
                    log.insert(applied, transformed);
                }
            }
        }
        let mut text = sharejs_text::units(&base);
        for (v, op) in log.range(base_version..) {
            sharejs_text::apply_units(&mut text, op)
                .unwrap_or_else(|error| panic!("{}: v{v} does not apply: {error}", recording.name));
        }
        (sharejs_text::text(&text), compared)
    }

    #[test]
    fn sharejs_oracle_matches_recorded_ce_sessions() {
        let sessions: Vec<Recording> = recordings()
            .into_iter()
            .filter(|recording| recording.format == "sharejs-text-ot")
            .collect();
        assert!(
            sessions.len() >= 5,
            "expected the ShareJS recordings, found {}",
            sessions.len()
        );
        let mut transformed = 0;
        let mut replayed = 0;
        for recording in &sessions {
            for trace in recording.traces.iter().filter(|trace| !trace.scripted) {
                let Some(expected) = recording.final_text(&trace.name) else {
                    continue;
                };
                let text = replay_sharejs_client(recording, trace);
                assert_eq!(
                    text, expected,
                    "{}: {}'s replayed text",
                    recording.name, trace.name
                );
                replayed += 1;
            }
            if let Some(expected) = recording.final_text(&recording.traces[0].name) {
                let (text, compared) = replay_sharejs_server(recording);
                assert_eq!(
                    text, expected,
                    "{}: the server's replayed text",
                    recording.name
                );
                transformed += compared;
            }
        }
        assert!(replayed >= 10, "only {replayed} client sessions replayed");
        assert!(
            transformed >= 3,
            "only {transformed} server-side transforms were checked"
        );
    }

    #[test]
    fn history_ot_fixture_reports_type_history_ot() {
        let all = recordings();
        let history: Vec<&Recording> = all
            .iter()
            .filter(|recording| recording.project == "history-ot-project")
            .collect();
        assert!(history.len() >= 3);
        for recording in &all {
            let expected = if recording.project == "history-ot-project" {
                "history-ot"
            } else {
                "sharejs-text-ot"
            };
            assert_eq!(recording.format, expected, "{}", recording.name);
            for trace in recording.traces.iter().filter(|trace| !trace.scripted) {
                assert_eq!(
                    trace.join_doc_type.as_deref(),
                    Some(expected),
                    "{}: {}",
                    recording.name,
                    trace.name
                );
                let replies = trace.join_doc_replies(&recording.doc_id);
                assert!(
                    !replies.is_empty(),
                    "{}: {} never joined the doc",
                    recording.name,
                    trace.name
                );
                for reply in replies {
                    assert_eq!(
                        reply[5], expected,
                        "{}: {}'s joinDoc reply",
                        recording.name, trace.name
                    );
                    if expected == "history-ot" {
                        assert!(
                            reply[1].get("content").is_some(),
                            "history-ot lines are the raw snapshot"
                        );
                    } else {
                        assert!(reply[1].is_array(), "ShareJS lines are an array");
                    }
                }
            }
        }
    }

    fn visible(content: &[u16], tracked: &[Option<Value>]) -> String {
        let kept: Vec<u16> = content
            .iter()
            .zip(tracked)
            .filter(|(_, mark)| {
                mark.as_ref().and_then(|mark| mark["type"].as_str()) != Some("delete")
            })
            .map(|(unit, _)| *unit)
            .collect();
        sharejs_text::text(&kept)
    }

    fn text_operations(update: &Value) -> Vec<TextOperation> {
        update["op"]
            .as_array()
            .unwrap()
            .iter()
            .map(|edit| TextOperation::from_json(&edit["textOperation"]).unwrap())
            .collect()
    }

    fn replay_history_ot_client(
        recording: &Recording,
        trace: &Trace,
    ) -> (Vec<u16>, Vec<Option<Value>>) {
        let (reply, events) = trace.last_session(&recording.doc_id).unwrap();
        let (text, _) = snapshot_of(&reply).unwrap();
        let mut content = sharejs_text::units(&text);
        let mut tracked = vec![None; content.len()];
        let mut inflight: Option<Vec<TextOperation>> = None;
        for event in events {
            match event {
                DocEvent::Sent { update, .. } => {
                    let operations = text_operations(&update);
                    for operation in &operations {
                        (content, tracked) = operation.apply(&content, &tracked).unwrap();
                    }
                    inflight = Some(operations);
                }
                DocEvent::Acked { .. } => {
                    inflight = None;
                }
                DocEvent::Remote { update, .. } => {
                    for mut remote in text_operations(&update) {
                        if let Some(mine) = inflight.as_mut() {
                            for own in mine.iter_mut() {
                                let (own_after, remote_after) =
                                    TextOperation::transform(own, &remote).unwrap();
                                *own = own_after;
                                remote = remote_after;
                            }
                        }
                        (content, tracked) = remote.apply(&content, &tracked).unwrap();
                    }
                }
                DocEvent::Error { args } => {
                    panic!("{}: {} got an error {args:?}", recording.name, trace.name)
                }
            }
        }
        (content, tracked)
    }

    fn deleted_runs(tracked: &[Option<Value>]) -> Vec<(usize, usize)> {
        tracked
            .iter()
            .enumerate()
            .filter(|(_, mark)| {
                mark.as_ref().and_then(|mark| mark["type"].as_str()) == Some("delete")
            })
            .fold(Vec::new(), |mut runs: Vec<(usize, usize)>, (at, _)| {
                match runs.last_mut() {
                    Some((start, length)) if *start + *length == at => *length += 1,
                    _ => runs.push((at, 1)),
                }
                runs
            })
    }

    #[test]
    fn history_ot_sessions_that_converged_replay_through_the_ot_text_model() {
        let mut replayed = 0;
        for recording in recordings()
            .iter()
            .filter(|recording| recording.format == "history-ot" && recording.converged)
        {
            for trace in recording.traces.iter().filter(|trace| !trace.scripted) {
                let Some(expected) = recording.final_text(&trace.name) else {
                    continue;
                };
                let (content, tracked) = replay_history_ot_client(recording, trace);
                assert_eq!(
                    visible(&content, &tracked),
                    expected,
                    "{}: {}",
                    recording.name,
                    trace.name
                );
                if let Some(raw) = recording.extra("final.raw.json") {
                    let raw: Value = serde_json::from_str(&raw).unwrap();
                    assert_eq!(
                        sharejs_text::text(&content),
                        raw["raw"]["content"].as_str().unwrap()
                    );
                    let hidden: Vec<(usize, usize)> = raw["raw"]["trackedChanges"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|change| change["tracking"]["type"] == "delete")
                        .map(|change| {
                            (
                                change["range"]["pos"].as_u64().unwrap() as usize,
                                change["range"]["length"].as_u64().unwrap() as usize,
                            )
                        })
                        .collect();
                    assert_eq!(
                        deleted_runs(&tracked),
                        hidden,
                        "{}: tracked deletes",
                        recording.name
                    );
                }
                replayed += 1;
            }
        }
        assert!(
            replayed >= 4,
            "only {replayed} history-ot client sessions replayed"
        );
    }

    #[test]
    fn history_ot_concurrent_updates_come_back_with_the_senders_base_version() {
        let recording = recordings()
            .into_iter()
            .find(|recording| recording.name == "history-ot-typing")
            .unwrap();
        assert!(!recording.converged);
        let repeated = recording
            .traces
            .iter()
            .flat_map(|trace| versions_reported(trace, &recording.doc_id))
            .filter(|(_, count)| *count > 1)
            .count();
        assert!(
            repeated > 0,
            "CE now reports a fresh version for every history-ot update; revisit protocol.md §3"
        );
    }

    #[test]
    fn ce_sends_applied_ops_to_clients_that_never_joined_the_doc() {
        let recording = recordings()
            .into_iter()
            .find(|recording| recording.name == "project-room-broadcast")
            .unwrap();
        let watcher = recording.trace("dave");
        assert!(watcher.join_doc_replies(&recording.doc_id).is_empty());
        let remote = watcher
            .doc_events(&recording.doc_id)
            .into_iter()
            .filter(|event| matches!(event, DocEvent::Remote { .. }))
            .count();
        assert!(remote >= 2, "the project room carried only {remote} ops");
    }

    #[test]
    fn fixtures_hold_no_secrets() {
        let needles = [
            "overleaf_session2",
            "sharelatex.sid",
            "overleaf.sid",
            "csrf",
            "\"cookie\"",
            "\"set-cookie\"",
            "password",
        ];
        let mut files = 0;
        let mut pending = vec![PathBuf::from(FIXTURES)];
        while let Some(dir) = pending.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    pending.push(path);
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap().to_lowercase();
                for needle in needles {
                    assert!(
                        !text.contains(needle),
                        "{} contains {needle}",
                        path.display()
                    );
                }
                files += 1;
            }
        }
        assert!(files >= 20, "only {files} fixture files were scanned");
    }
}
