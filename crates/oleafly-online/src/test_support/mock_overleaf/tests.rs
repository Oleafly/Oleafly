use super::*;
use crate::test_support::overleaf_rt::{
    probe, probe_event, probe_frames, probe_http, probe_requests, probe_socket, probe_step,
    probe_steps, recordings, DocEvent,
};
use rand::{Rng, SeedableRng};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

const WAIT: Duration = Duration::from_secs(10);

fn call(id: u64, name: &str, args: &[Value]) -> String {
    codec::encode(&Frame::call(id, name, args))
}

fn project() -> MockProject {
    MockProject::new("demo")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .member(MockUser::named("erin"), Privilege::ReadAndWrite)
        .outsider(MockUser::named("zed"))
        .doc("main.tex", "\\documentclass{article}\nHello")
        .doc("sections/other.tex", "Other text")
        .file("figure.png", b"\x89PNG\r\n\x1a\nfake")
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    WebSocket,
    Polling,
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[derive(Debug, PartialEq)]
enum Ending {
    Disconnect,
    CloseFrame,
    Abrupt,
    NotHandshaken,
}

struct Socket {
    kind: Kind,
    ws: Option<WsStream>,
    http: reqwest::Client,
    channel: String,
    cookie: String,
    queued: VecDeque<String>,
    ended: Option<Ending>,
}

async fn handshake_with(
    mock: &MockOverleaf,
    cookie: &str,
    project_id: &str,
    extra: &str,
) -> String {
    reqwest::Client::new()
        .get(format!(
            "{}/socket.io/1/?projectId={project_id}{extra}&t=1",
            mock.base
        ))
        .header("Cookie", cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap()
}

async fn handshake(mock: &MockOverleaf, cookie: &str) -> String {
    handshake_with(mock, cookie, &mock.project_id(), "").await
}

impl Socket {
    async fn open(mock: &MockOverleaf, user: &str, kind: Kind) -> Socket {
        let cookie = mock.user(user).cookie();
        Socket::open_with(mock, &cookie, &mock.project_id(), kind, "").await
    }

    async fn open_with(
        mock: &MockOverleaf,
        cookie: &str,
        project_id: &str,
        kind: Kind,
        extra: &str,
    ) -> Socket {
        let reply = handshake_with(mock, cookie, project_id, extra).await;
        let sid = reply.split(':').next().unwrap().to_string();
        let query = format!("projectId={project_id}{extra}");
        let mut socket = Socket {
            kind,
            ws: None,
            http: reqwest::Client::new(),
            channel: format!("{}/socket.io/1/xhr-polling/{sid}?{query}", mock.base),
            cookie: cookie.to_string(),
            queued: VecDeque::new(),
            ended: None,
        };
        if kind == Kind::WebSocket {
            let url = format!(
                "{}/socket.io/1/websocket/{sid}?{query}",
                mock.base.replace("http://", "ws://")
            );
            let mut request = url.into_client_request().unwrap();
            request
                .headers_mut()
                .insert("Cookie", HeaderValue::from_str(cookie).unwrap());
            let (ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
            socket.ws = Some(ws);
        }
        socket
    }

    async fn joined(mock: &MockOverleaf, user: &str, kind: Kind) -> (Socket, Value) {
        let mut socket = Socket::open(mock, user, kind).await;
        let response = socket.event("joinProjectResponse").await;
        (socket, response[0].clone())
    }

    async fn send(&mut self, packet: &str) {
        match self.kind {
            Kind::WebSocket => self
                .ws
                .as_mut()
                .unwrap()
                .send(Message::text(packet.to_string()))
                .await
                .unwrap(),
            Kind::Polling => {
                let reply = self
                    .http
                    .post(&self.channel)
                    .header("Cookie", &self.cookie)
                    .body(packet.to_string())
                    .send()
                    .await
                    .unwrap();
                reply.text().await.unwrap();
            }
        }
    }

    async fn receive(&mut self) -> Option<String> {
        loop {
            if let Some(packet) = self.queued.pop_front() {
                if packet.starts_with("0::") {
                    self.ended = Some(Ending::Disconnect);
                } else if packet.starts_with("7:") {
                    self.ended = Some(Ending::NotHandshaken);
                }
                return Some(packet);
            }
            if self.ended.is_some() && self.kind == Kind::Polling {
                return None;
            }
            match self.kind {
                Kind::WebSocket => match self.ws.as_mut().unwrap().next().await {
                    Some(Ok(Message::Text(text))) => self.queued.push_back(text.to_string()),
                    Some(Ok(Message::Close(_))) => {
                        self.ended.get_or_insert(Ending::CloseFrame);
                        return None;
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(_)) | None => {
                        if self.ended.is_none() {
                            self.ended = Some(Ending::Abrupt);
                        }
                        return None;
                    }
                },
                Kind::Polling => {
                    let reply = self
                        .http
                        .get(&self.channel)
                        .header("Cookie", &self.cookie)
                        .send()
                        .await
                        .ok()?;
                    let body = reply.text().await.ok()?;
                    self.queued.extend(
                        codec::decode_payload(&body)
                            .into_iter()
                            .filter(|packet| packet != "8::"),
                    );
                }
            }
        }
    }

    async fn next(&mut self) -> String {
        loop {
            let packet = tokio::time::timeout(WAIT, self.receive())
                .await
                .expect("no packet in time")
                .expect("the connection closed");
            if packet != "2::" {
                return packet;
            }
        }
    }

    async fn quiet_for(&mut self, period: Duration) -> Option<String> {
        loop {
            match tokio::time::timeout(period, self.receive()).await {
                Err(_) => return None,
                Ok(Some(packet)) if packet == "2::" => continue,
                Ok(packet) => return packet,
            }
        }
    }

    async fn event(&mut self, wanted: &str) -> Vec<Value> {
        loop {
            let packet = self.next().await;
            if let Some((name, args)) = codec::decode(&packet).ok().and_then(Frame::into_event) {
                if name == wanted {
                    return args;
                }
            }
        }
    }

    async fn ack(&mut self, id: u64) -> Vec<Value> {
        loop {
            let packet = self.next().await;
            if let Some((got, args)) = codec::decode(&packet).ok().and_then(Frame::into_ack) {
                if got == id {
                    return args;
                }
            }
        }
    }

    async fn ending(&mut self) -> Ending {
        loop {
            match tokio::time::timeout(WAIT, self.receive())
                .await
                .expect("no ending in time")
            {
                None => return self.ended.take().unwrap_or(Ending::Abrupt),
                Some(packet) if packet.starts_with("0::") || packet.starts_with("7:") => {
                    return self.ended.take().unwrap();
                }
                Some(_) => continue,
            }
        }
    }
}

fn join_options() -> Value {
    json!({ "encodeRanges": true, "supportsHistoryOT": true })
}

async fn eventually(check: impl Fn() -> bool) {
    let started = tokio::time::Instant::now();
    while !check() {
        assert!(started.elapsed() < WAIT, "the condition never held");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

fn url(mock: &MockOverleaf, path: &str) -> String {
    format!("{}/project/{}{path}", mock.base, mock.project_id())
}

fn ce_ack_error(probe: &str) -> Value {
    probe_frames(probe, "xhr-polling")
        .iter()
        .filter(|frame| !frame.outgoing)
        .filter_map(|frame| codec::decode(&frame.raw).ok()?.into_ack())
        .map(|(_, args)| args)
        .find(|args| {
            args.first()
                .is_some_and(|first| first.get("message").is_some())
        })
        .map(|args| args[0].clone())
        .unwrap_or_else(|| panic!("probe {probe} has no error reply"))
}

fn keys(value: &Value) -> BTreeSet<String> {
    value
        .as_object()
        .map(|object| object.keys().cloned().collect())
        .unwrap_or_default()
}

fn kinds(values: &[Value]) -> Vec<&'static str> {
    values
        .iter()
        .map(|value| match value {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::String(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        })
        .collect()
}

#[tokio::test]
async fn mock_serves_both_transports() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut sockets = Vec::new();
    for (index, kind) in [Kind::WebSocket, Kind::Polling].into_iter().enumerate() {
        let mut socket = Socket::open(&mock, "alice", kind).await;
        assert_eq!(socket.next().await, "1::", "{kind:?}");
        let joined = socket.event("joinProjectResponse").await;
        assert_eq!(joined[0]["permissionsLevel"], "owner");
        assert_eq!(joined[0]["project"]["_id"], mock.project_id());
        socket
            .send(&call(1, "joinDoc", &[json!(doc), join_options()]))
            .await;
        let reply = socket.ack(1).await;
        assert!(reply[0].is_null());
        assert_eq!(reply[5], "sharejs-text-ot");
        assert_eq!(reply[2], index as u64);
        let update =
            json!({ "doc": doc, "op": [{ "p": 0, "i": format!("{kind:?} ") }], "v": index });
        socket
            .send(&call(2, "applyOtUpdate", &[json!(doc), update]))
            .await;
        assert_eq!(socket.ack(2).await, Vec::<Value>::new());
        let applied = socket.event("otUpdateApplied").await;
        assert_eq!(applied[0], json!({ "v": index, "doc": doc }));
        sockets.push(socket);
    }
    assert_eq!(
        mock.doc_text(&doc),
        "Polling WebSocket \\documentclass{article}\nHello"
    );
    let mut transports: Vec<Transport> = mock
        .connections()
        .iter()
        .map(|connection| connection.transport)
        .collect();
    transports.sort_by_key(|transport| format!("{transport:?}"));
    assert_eq!(transports, vec![Transport::Polling, Transport::WebSocket]);
    let remote = sockets[0].event("otUpdateApplied").await;
    assert_eq!(remote[0]["op"], json!([{ "p": 0, "i": "Polling " }]));
    assert_eq!(remote[0]["v"], 1);
}

#[tokio::test]
async fn mock_offers_polling_only_when_websocket_is_off() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.websocket = false);
    let reply = handshake(&mock, &mock.user("alice").cookie()).await;
    assert!(reply.ends_with(":60:60:xhr-polling"), "{reply}");
    let sid = reply.split(':').next().unwrap();
    let url = format!(
        "{}/socket.io/1/websocket/{sid}?projectId={}",
        mock.base.replace("http://", "ws://"),
        mock.project_id()
    );
    assert!(tokio_tungstenite::connect_async(url).await.is_err());
}

#[tokio::test]
async fn mock_handshake_can_answer_like_a_socket_io_v2_server() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.handshake_reply = Some((200, "0{\"sid\":\"v2\"}".into())));
    assert_eq!(
        handshake(&mock, &mock.user("alice").cookie()).await,
        "0{\"sid\":\"v2\"}"
    );
}

#[tokio::test]
async fn mock_heartbeats_reach_socket_clients() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.heartbeat = Some(Duration::from_millis(50)));
    let (mut socket, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    let beat = tokio::time::timeout(WAIT, socket.receive())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(beat, "2::");
}

#[tokio::test]
async fn mock_closes_a_client_that_sends_a_malformed_frame() {
    let mock = MockOverleaf::start(project()).await;
    let (mut socket, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    socket.send("not a frame").await;
    assert_eq!(socket.ending().await, Ending::Disconnect);
    assert!(mock.connections().is_empty());
}

#[tokio::test]
async fn mock_can_send_a_malformed_frame_to_a_client() {
    let mock = MockOverleaf::start(project()).await;
    let (mut socket, joined) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    mock.send_raw(joined["publicId"].as_str().unwrap(), "5:::{broken");
    assert_eq!(socket.next().await, "5:::{broken");
}

#[tokio::test]
async fn mock_drop_cuts_a_client_without_a_disconnect_packet() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("bob");
    let (mut ws, ws_joined) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    let (mut polled, polled_joined) = Socket::joined(&mock, "erin", Kind::Polling).await;
    mock.drop_client(ws_joined["publicId"].as_str().unwrap());
    mock.drop_client(polled_joined["publicId"].as_str().unwrap());
    assert_eq!(ws.ending().await, Ending::Abrupt);
    assert_eq!(polled.ending().await, Ending::NotHandshaken);
    assert_eq!(watcher.events("clientTracking.clientDisconnected").len(), 2);
}

#[tokio::test]
async fn mock_stall_withholds_every_packet_until_resumed() {
    let mock = MockOverleaf::start(project()).await;
    let (mut ws, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    let (mut polled, _) = Socket::joined(&mock, "bob", Kind::Polling).await;
    mock.configure(|config| config.poll_hold = Duration::from_millis(100));
    mock.stall();
    mock.emit_to_room("projectNameUpdated", &[json!("Renamed")]);
    assert_eq!(ws.quiet_for(Duration::from_millis(300)).await, None);
    let held = polled
        .http
        .get(&polled.channel)
        .header("Cookie", &polled.cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(held, "8::", "a stalled server answers a poll with nothing");
    mock.resume();
    assert_eq!(ws.event("projectNameUpdated").await, vec![json!("Renamed")]);
    assert_eq!(
        polled.event("projectNameUpdated").await,
        vec![json!("Renamed")]
    );
}

#[tokio::test]
async fn mock_crash_drops_everyone_and_refuses_handshakes_until_recovered() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut peer = mock.peer("bob");
    peer.join(&doc);
    peer.type_at(&doc, 0, "kept ");
    let (mut ws, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    mock.crash();
    assert_eq!(ws.ending().await, Ending::Abrupt);
    assert!(!peer.is_connected());
    let refused = http()
        .get(format!(
            "{}/socket.io/1/?projectId={}&t=1",
            mock.base,
            mock.project_id()
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 503);
    mock.recover();
    let (_, joined) = Socket::joined(&mock, "alice", Kind::Polling).await;
    assert_eq!(joined["permissionsLevel"], "owner");
    assert_eq!(mock.doc_text(&doc), "kept \\documentclass{article}\nHello");
}

#[tokio::test]
async fn mock_frames_have_the_shapes_ce_sent() {
    for (scenario, format) in [
        ("two-users-typing", DocFormat::ShareJs),
        ("history-ot-turns", DocFormat::HistoryOt),
    ] {
        let recording = recordings()
            .into_iter()
            .find(|recording| recording.name == scenario)
            .unwrap();
        let trace = recording.trace("alice");
        let event = |name: &str| {
            trace
                .packets()
                .filter(|(outgoing, _)| !outgoing)
                .filter_map(|(_, packet)| packet.into_event())
                .find(|(found, _)| found == name)
                .map(|(_, args)| args[0].clone())
                .unwrap()
        };
        let ce_join = event("joinProjectResponse");
        let ce_cursor = event("clientTracking.clientUpdated");
        let ce_reply = trace.join_doc_replies(&recording.doc_id).remove(0);
        let ce_remote = trace
            .doc_events(&recording.doc_id)
            .into_iter()
            .find_map(|event| match event {
                DocEvent::Remote { update, .. } => Some(update),
                _ => None,
            })
            .unwrap();

        let mock = MockOverleaf::start(project().format(format)).await;
        let doc = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        let mut bob = mock.peer("bob");
        alice.join(&doc);
        bob.join(&doc);
        bob.type_at(&doc, 0, "x");
        bob.emit(
            "clientTracking.updatePosition",
            vec![json!({ "row": 0, "column": 1, "doc_id": doc })],
        );
        let mock_join = alice.events("joinProjectResponse")[0][0].clone();
        let mock_remote = alice
            .events("otUpdateApplied")
            .into_iter()
            .find(|args| args[0].get("op").is_some())
            .unwrap()[0]
            .clone();
        let mock_cursor = alice.events("clientTracking.clientUpdated")[0][0].clone();
        let mock_reply = alice
            .emit("joinDoc", vec![json!(doc), join_options()])
            .unwrap();

        assert_eq!(
            keys(&mock_join),
            keys(&ce_join),
            "{scenario}: joinProjectResponse"
        );
        assert_eq!(
            keys(&mock_join["project"]),
            keys(&ce_join["project"]),
            "{scenario}: project"
        );
        assert_eq!(
            keys(&mock_join["project"]["owner"]),
            keys(&ce_join["project"]["owner"])
        );
        assert_eq!(
            kinds(&mock_reply),
            kinds(&ce_reply),
            "{scenario}: joinDoc reply"
        );
        assert_eq!(mock_reply[5], ce_reply[5]);
        let required: BTreeSet<String> = ["doc", "op", "v", "meta"]
            .iter()
            .map(ToString::to_string)
            .collect();
        assert!(required.is_subset(&keys(&ce_remote)) && required.is_subset(&keys(&mock_remote)));
        assert_eq!(
            keys(&mock_remote["meta"]),
            keys(&ce_remote["meta"]),
            "{scenario}: meta"
        );
        assert_eq!(
            keys(&mock_cursor),
            keys(&ce_cursor),
            "{scenario}: clientUpdated"
        );
    }
}

async fn rejection(
    mock: &MockOverleaf,
    cookie: &str,
    project_id: &str,
    kind: Kind,
) -> (Vec<String>, Ending) {
    let mut socket = Socket::open_with(mock, cookie, project_id, kind, "").await;
    let mut packets = Vec::new();
    loop {
        match tokio::time::timeout(WAIT, socket.receive()).await.unwrap() {
            Some(packet) if packet.starts_with("0::") || packet.starts_with("7:") => {
                packets.push(packet);
                return (packets, socket.ended.take().unwrap());
            }
            Some(packet) => packets.push(packet),
            None => return (packets, socket.ended.take().unwrap_or(Ending::Abrupt)),
        }
    }
}

fn rejected_with(packets: &[String]) -> Option<Vec<Value>> {
    packets
        .iter()
        .filter_map(|packet| codec::decode(packet).ok()?.into_event())
        .find(|(name, _)| name == "connectionRejected")
        .map(|(_, args)| args)
}

#[tokio::test]
async fn mock_rejects_a_client_without_a_session_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let (packets, ending) = rejection(
        &mock,
        "overleaf.sid=unknown",
        &mock.project_id(),
        Kind::WebSocket,
    )
    .await;
    assert_eq!(
        rejected_with(&packets),
        probe_event(
            "connection-rejected-no-session",
            "websocket",
            "connectionRejected"
        )
    );
    assert_eq!(ending, Ending::Disconnect);
}

#[tokio::test]
async fn mock_loses_early_rejections_over_polling_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    for (probe, cookie, project_id) in [
        (
            "connection-rejected-no-session",
            "overleaf.sid=unknown".to_string(),
            mock.project_id(),
        ),
        (
            "connection-rejected-bad-project-id",
            mock.user("alice").cookie(),
            "not-a-project".to_string(),
        ),
    ] {
        let (packets, ending) = rejection(&mock, &cookie, &project_id, Kind::Polling).await;
        let ce: Vec<String> = probe_frames(probe, "xhr-polling")
            .into_iter()
            .filter(|frame| !frame.outgoing)
            .map(|frame| frame.raw)
            .collect();
        assert_eq!(packets, ce, "{probe}");
        assert_eq!(ending, Ending::NotHandshaken);
    }
}

#[tokio::test]
async fn mock_rejects_a_non_member_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    for (kind, transport) in [
        (Kind::WebSocket, "websocket"),
        (Kind::Polling, "xhr-polling"),
    ] {
        let (packets, _) =
            rejection(&mock, &mock.user("zed").cookie(), &mock.project_id(), kind).await;
        assert_eq!(
            rejected_with(&packets),
            probe_event(
                "connection-rejected-not-a-member",
                transport,
                "connectionRejected"
            )
        );
    }
}

#[tokio::test]
async fn mock_rejects_an_unknown_project_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let (packets, _) = rejection(
        &mock,
        &mock.user("alice").cookie(),
        "ffffffffffffffffffffffff",
        Kind::WebSocket,
    )
    .await;
    assert_eq!(
        rejected_with(&packets),
        probe_event(
            "connection-rejected-project-not-found",
            "websocket",
            "connectionRejected"
        )
    );
}

#[tokio::test]
async fn mock_rejects_a_bad_project_id_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let (packets, _) = rejection(
        &mock,
        &mock.user("alice").cookie(),
        "not-a-project",
        Kind::WebSocket,
    )
    .await;
    assert_eq!(
        rejected_with(&packets),
        probe_event(
            "connection-rejected-bad-project-id",
            "websocket",
            "connectionRejected"
        )
    );
}

#[tokio::test]
async fn mock_rate_limits_project_joins_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.rate_limits.joins_per_minute = 3);
    for _ in 0..3 {
        Socket::joined(&mock, "dave", Kind::WebSocket).await;
    }
    let (packets, _) = rejection(
        &mock,
        &mock.user("dave").cookie(),
        &mock.project_id(),
        Kind::WebSocket,
    )
    .await;
    assert_eq!(
        rejected_with(&packets),
        probe_event(
            "connection-rejected-rate-limit",
            "xhr-polling",
            "connectionRejected"
        )
    );
    Socket::joined(&mock, "alice", Kind::WebSocket).await;
}

#[tokio::test]
async fn mock_rejects_with_retry_while_shutting_down() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.reject_connections = Some(Rejection::Retry));
    let (packets, ending) = rejection(
        &mock,
        &mock.user("alice").cookie(),
        &mock.project_id(),
        Kind::WebSocket,
    )
    .await;
    assert_eq!(
        rejected_with(&packets),
        Some(vec![json!({ "message": "retry" })])
    );
    assert_eq!(ending, Ending::Disconnect);
}

#[tokio::test]
async fn mock_rejects_with_a_server_error() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.reject_connections = Some(Rejection::Error));
    let (packets, _) = rejection(
        &mock,
        &mock.user("alice").cookie(),
        &mock.project_id(),
        Kind::WebSocket,
    )
    .await;
    assert_eq!(
        rejected_with(&packets),
        Some(vec![json!({ "message": "error" })])
    );
}

#[tokio::test]
async fn mock_serves_history_ot_docs_only_to_clients_that_support_them() {
    let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
    let doc = mock.doc_id("main.tex");
    let (mut socket, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    socket
        .send(&call(
            1,
            "joinDoc",
            &[json!(doc), json!({ "encodeRanges": true })],
        ))
        .await;
    assert_eq!(
        socket.ack(1).await[0],
        ce_ack_error("join-doc-without-history-ot-support")
    );
    socket
        .send(&call(2, "joinDoc", &[json!(doc), join_options()]))
        .await;
    let reply = socket.ack(2).await;
    assert_eq!(reply[5], "history-ot");
    assert_eq!(
        reply[1],
        json!({ "content": "\\documentclass{article}\nHello" })
    );
}

#[tokio::test]
async fn mock_join_doc_catches_up_from_a_version() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    for word in ["one ", "two ", "three "] {
        alice.type_at(&doc, 0, word);
    }
    let mut bob = mock.peer("bob");
    let reply = bob
        .emit("joinDoc", vec![json!(doc), json!(1), join_options()])
        .unwrap();
    assert_eq!(reply[2], 3);
    let updates = reply[3].as_array().unwrap();
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0]["op"], json!([{ "p": 0, "i": "two " }]));
    assert_eq!(updates[1]["v"], 2);
}

#[tokio::test]
async fn mock_join_doc_reports_missing_ops_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.kept_ops = 2);
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    for word in ["one ", "two ", "three "] {
        alice.type_at(&doc, 0, word);
    }
    let reply = alice
        .emit("joinDoc", vec![json!(doc), json!(0), join_options()])
        .unwrap();
    assert_eq!(reply[0], ce_ack_error("join-doc-missing-ops"));
    let kept = alice
        .emit("joinDoc", vec![json!(doc), json!(1), join_options()])
        .unwrap();
    assert!(kept[0].is_null());
}

#[tokio::test]
async fn mock_join_doc_ahead_of_the_doc_answers_with_no_updates_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    alice.type_at(&doc, 0, "one ");
    let reply = alice
        .emit("joinDoc", vec![json!(doc), json!(6), join_options()])
        .unwrap();
    assert!(reply[0].is_null());
    assert_eq!((reply[2].clone(), reply[3].clone()), (json!(1), json!([])));
    let ce = probe_frames("join-doc-missing-ops", "xhr-polling")
        .iter()
        .filter_map(|frame| codec::decode(&frame.raw).ok()?.into_ack())
        .map(|(_, args)| args)
        .find(|args| args.len() > 3 && args[3] == json!([]) && args[2] == json!(110))
        .expect("the probe answered a joinDoc ahead of the doc");
    assert!(ce[0].is_null());
}

#[tokio::test]
async fn mock_join_doc_refuses_unknown_options() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    let reply = alice
        .emit("joinDoc", vec![json!(doc), json!({ "surprise": true })])
        .unwrap();
    assert_eq!(reply[0]["message"], "unexpected arguments");
    assert!(!alice.is_connected());
}

#[tokio::test]
async fn mock_acks_an_update_before_announcing_it_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let (mut socket, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    socket
        .send(&call(1, "joinDoc", &[json!(doc), join_options()]))
        .await;
    socket.ack(1).await;
    let update = json!({ "doc": doc, "op": [{ "p": 0, "i": "x" }], "v": 0 });
    socket
        .send(&call(2, "applyOtUpdate", &[json!(doc), update]))
        .await;
    assert_eq!(socket.next().await, "6:::2");
    assert_eq!(
        socket.next().await,
        event("otUpdateApplied", &[json!({ "v": 0, "doc": doc })])
    );
}

#[tokio::test]
async fn mock_broadcasts_to_the_project_room_and_can_switch_to_doc_rooms() {
    let mock = MockOverleaf::start(project()).await;
    let main = mock.doc_id("main.tex");
    let other = mock.doc_id("sections/other.tex");
    let mut alice = mock.peer("alice");
    let mut bob = mock.peer("bob");
    let mut erin = mock.peer("erin");
    alice.join(&main);
    bob.join(&main);
    erin.join(&other);
    let (mut socket, _) = Socket::joined(&mock, "dave", Kind::WebSocket).await;
    let seen = |peer: &mut MockPeer| {
        peer.events("otUpdateApplied")
            .iter()
            .filter(|args| args[0]["doc"] == main && args[0].get("op").is_some())
            .count()
    };
    alice.type_at(&main, 0, "x");
    assert_eq!(seen(&mut bob), 1);
    assert_eq!(
        seen(&mut erin),
        1,
        "the project room reaches clients that never joined the doc"
    );
    assert_eq!(
        socket.event("otUpdateApplied").await[0]["op"],
        json!([{ "p": 0, "i": "x" }])
    );
    mock.configure(|config| config.legacy_doc_rooms = true);
    alice.type_at(&main, 1, "y");
    assert_eq!(seen(&mut bob), 2);
    assert_eq!(
        seen(&mut erin),
        1,
        "doc rooms only reach clients that joined the doc"
    );
    assert_eq!(bob.text(&main), "xy\\documentclass{article}\nHello");
}

#[tokio::test]
async fn mock_doc_error_disconnects_every_joined_client() {
    let mock = MockOverleaf::start(project()).await;
    let main = mock.doc_id("main.tex");
    let other = mock.doc_id("sections/other.tex");
    let mut alice = mock.peer("alice");
    let mut erin = mock.peer("erin");
    alice.join(&main);
    erin.join(&other);
    let (mut bob, _) = Socket::joined(&mock, "bob", Kind::WebSocket).await;
    bob.send(&call(1, "joinDoc", &[json!(main), join_options()]))
        .await;
    bob.ack(1).await;
    let bad = json!({ "doc": main, "op": [{ "p": 0, "d": "not there" }], "v": 0 });
    assert_eq!(
        alice.emit("applyOtUpdate", vec![json!(main), bad]),
        Some(Vec::new())
    );
    let error = bob.event("otUpdateError").await;
    assert!(error[0].as_str().unwrap().contains("does not match"));
    let recorded = recordings()
        .into_iter()
        .find(|recording| recording.name == "delete-open-file")
        .unwrap();
    let ce = recorded
        .trace("alice")
        .packets()
        .filter_map(|(_, packet)| packet.into_event())
        .find(|(name, _)| name == "otUpdateError")
        .unwrap()
        .1;
    assert_eq!(keys(&error[1]), keys(&ce[1]));
    assert_eq!(bob.ending().await, Ending::Disconnect);
    assert!(!alice.is_connected(), "the sender is disconnected too");
    assert!(
        erin.is_connected(),
        "a client that never joined the doc stays"
    );
    assert_eq!(erin.events("clientTracking.clientDisconnected").len(), 2);
}

#[tokio::test]
async fn mock_fail_next_update_runs_the_error_path_for_that_doc() {
    let mock = MockOverleaf::start(project()).await;
    let other = mock.doc_id("sections/other.tex");
    let mut erin = mock.peer("erin");
    erin.join(&other);
    mock.fail_next_update(&other, "injected failure");
    erin.type_at(&other, 0, "z");
    assert!(!erin.is_connected());
    assert_eq!(erin.events("otUpdateError")[0][0], "injected failure");
    assert_eq!(mock.doc_text(&other), "Other text");
}

#[tokio::test]
async fn mock_updates_to_a_deleted_doc_fail_with_doc_not_found_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("sections/other.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    let deleted = http()
        .delete(url(&mock, &format!("/doc/{doc}")))
        .header("Cookie", mock.user("bob").cookie())
        .header("X-Csrf-Token", MOCK_CSRF)
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), 204);
    let update = json!({ "doc": doc, "op": [{ "p": 0, "i": "x" }], "v": 0 });
    assert_eq!(
        alice.emit("applyOtUpdate", vec![json!(doc), update]),
        Some(Vec::new())
    );
    let error = alice.events("otUpdateError").remove(0);
    let recorded = recordings()
        .into_iter()
        .find(|recording| recording.name == "delete-open-file")
        .unwrap();
    let ce = recorded
        .trace("alice")
        .packets()
        .filter_map(|(_, packet)| packet.into_event())
        .find(|(name, _)| name == "otUpdateError")
        .unwrap()
        .1;
    assert_eq!(error[0], ce[0]);
    assert!(!alice.is_connected());
}

#[tokio::test]
async fn mock_transforms_a_concurrent_sharejs_insert_to_go_first_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    let mut bob = mock.peer("bob");
    alice.join(&doc);
    bob.join(&doc);
    alice.hold();
    bob.hold();
    alice.type_at(&doc, 0, "A");
    bob.type_at(&doc, 0, "B");
    alice.release();
    bob.release();
    assert!(
        mock.doc_text(&doc).starts_with("BA"),
        "{}",
        mock.doc_text(&doc)
    );
    assert_eq!(alice.text(&doc), bob.text(&doc));
}

#[tokio::test]
async fn mock_history_ot_reports_the_senders_base_version_like_ce() {
    let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    let mut bob = mock.peer("bob");
    alice.join(&doc);
    bob.join(&doc);
    alice.hold();
    bob.hold();
    alice.type_at(&doc, 0, "A");
    bob.type_at(&doc, 0, "B");
    alice.release();
    bob.release();
    let stale = alice.events("otUpdateApplied").last().unwrap()[0].clone();
    assert_eq!(
        stale["v"], 0,
        "CE reports the base version of a transformed history-ot update"
    );
    assert_eq!(
        stale["op"],
        json!([{ "textOperation": ["B", 30] }]),
        "the incoming insert goes first at a tie"
    );
    assert_eq!(mock.doc_version(&doc), 2);
    assert!(mock.doc_text(&doc).starts_with("BA"));
    assert_eq!(alice.text(&doc), bob.text(&doc));
}

#[tokio::test]
async fn mock_history_ot_can_report_the_applied_version() {
    let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
    mock.configure(|config| config.history_ot_applied_version = true);
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    let mut bob = mock.peer("bob");
    alice.join(&doc);
    bob.join(&doc);
    alice.hold();
    bob.hold();
    alice.type_at(&doc, 0, "A");
    bob.type_at(&doc, 0, "B");
    alice.release();
    bob.release();
    assert_eq!(alice.events("otUpdateApplied").last().unwrap()[0]["v"], 1);
    assert_eq!(
        bob.events("otUpdateApplied").last().unwrap()[0],
        json!({ "v": 1, "doc": doc })
    );
}

#[tokio::test]
async fn mock_refuses_a_sharejs_update_older_than_the_replay_window() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.max_op_age = 2);
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    for word in ["a", "b", "c"] {
        alice.type_at(&doc, 0, word);
    }
    let stale = json!({ "doc": doc, "op": [{ "p": 0, "i": "late" }], "v": 0 });
    alice.emit("applyOtUpdate", vec![json!(doc), stale]);
    assert_eq!(alice.events("otUpdateError")[0][0], "Op too old");
}

#[tokio::test]
async fn mock_accepts_and_ignores_a_sharejs_update_hash() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let text = format!("x{}", mock.doc_text(&doc));
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    let update = json!({ "doc": doc, "op": [{ "p": 0, "i": "x" }], "v": 0, "hash": "0000000000000000000000000000000000000000" });
    alice.emit("applyOtUpdate", vec![json!(doc), update]);
    assert!(alice.events("otUpdateError").is_empty());
    assert_eq!(mock.doc_text(&doc), text);
}

#[tokio::test]
async fn a_mock_peer_drops_an_op_that_cancelled_out() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    let mut bob = mock.peer("bob");
    bob.join(&doc);
    bob.hold();
    bob.delete(&doc, 0, 1);
    alice.delete(&doc, 0, 1);
    bob.sync();
    bob.release();
    assert!(bob.is_connected());
    assert_eq!(bob.text(&doc), mock.doc_text(&doc));
    assert_eq!(mock.doc_version(&doc), 1);
}

#[tokio::test]
async fn mock_replaces_surrogates_in_sharejs_inserts() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    let update = json!({ "doc": doc, "op": [{ "p": 0, "i": "\u{1F600}" }], "v": 0 });
    alice.emit("applyOtUpdate", vec![json!(doc), update]);
    assert!(mock
        .doc_text(&doc)
        .starts_with("\u{FFFD}\u{FFFD}\\documentclass"));
}

#[tokio::test]
async fn mock_dedupes_a_resend_with_dup_if_source() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    let mut bob = mock.peer("bob");
    alice.join(&doc);
    bob.join(&doc);
    let update = json!({ "doc": doc, "op": [{ "p": 0, "i": "once " }], "v": 0 });
    alice.emit("applyOtUpdate", vec![json!(doc), update.clone()]);
    let mut resend = update;
    resend["dupIfSource"] = json!([alice.public_id]);
    let mut again = mock.peer("alice");
    again.join(&doc);
    again.emit("applyOtUpdate", vec![json!(doc), resend]);
    assert_eq!(mock.doc_version(&doc), 1);
    assert_eq!(mock.doc_text(&doc), "once \\documentclass{article}\nHello");
    assert_eq!(
        again.events("otUpdateApplied").last().unwrap()[0],
        json!({ "v": 0, "doc": doc })
    );
    assert_eq!(bob.events("otUpdateApplied").len(), 1);
}

#[tokio::test]
async fn mock_refuses_a_reviewers_plain_edit_and_accepts_a_tracked_one() {
    let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    let mut carol = mock.peer("carol");
    carol.join(&doc);
    carol.type_at(&doc, 0, "plain ");
    assert!(
        !carol.is_connected(),
        "a reviewer's plain edit disconnects them, as CE does"
    );
    assert_eq!(mock.doc_text(&doc), "\\documentclass{article}\nHello");
    let mut carol = mock.peer("carol");
    carol.join(&doc);
    let hello = "\\documentclass{article}\n".encode_utf16().count();
    carol.track_delete(&doc, hello, 5);
    assert!(carol.is_connected());
    assert_eq!(mock.doc_text(&doc), "\\documentclass{article}\n");
    assert_eq!(alice.text(&doc), "\\documentclass{article}\n");
    let raw = mock.raw_doc(&doc);
    assert_eq!(raw["content"], "\\documentclass{article}\nHello");
    assert_eq!(
        raw["trackedChanges"][0]["range"],
        json!({ "pos": hello, "length": 5 })
    );
    alice.type_at(&doc, hello, "Hi ");
    assert_eq!(
        mock.raw_doc(&doc)["content"],
        "\\documentclass{article}\nHi Hello"
    );
}

#[tokio::test]
async fn mock_refuses_a_viewers_suggestion() {
    let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
    let doc = mock.doc_id("main.tex");
    let mut dave = mock.peer("dave");
    dave.join(&doc);
    dave.track_delete(&doc, 0, 1);
    assert!(!dave.is_connected());
    assert_eq!(mock.doc_text(&doc), "\\documentclass{article}\nHello");
}

#[tokio::test]
async fn mock_refuses_an_update_to_a_doc_the_client_never_joined() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    let update = json!({ "doc": doc, "op": [{ "p": 0, "i": "x" }], "v": 0 });
    let reply = alice
        .emit("applyOtUpdate", vec![json!(doc), update])
        .unwrap();
    assert_eq!(reply[0], json!({ "message": "not authorized" }));
    assert!(!alice.is_connected());
}

#[tokio::test]
async fn mock_peers_converge_on_concurrent_edits_in_both_formats() {
    for (format, applied_version) in [
        (DocFormat::ShareJs, true),
        (DocFormat::HistoryOt, false),
        (DocFormat::HistoryOt, true),
    ] {
        let mock = MockOverleaf::start(project().format(format)).await;
        mock.configure(|config| config.history_ot_applied_version = applied_version);
        let doc = mock.doc_id("main.tex");
        let mut peers = vec![mock.peer("alice"), mock.peer("bob"), mock.peer("erin")];
        for peer in &mut peers {
            peer.join(&doc);
        }
        let mut rng = rand::rngs::StdRng::seed_from_u64(458);
        for round in 0..150 {
            let who = rng.gen_range(0..peers.len());
            let peer = &mut peers[who];
            if rng.gen_bool(0.3) {
                peer.hold();
            }
            let length = peer.text(&doc).encode_utf16().count();
            if length > 3 && rng.gen_bool(0.4) {
                let at = rng.gen_range(0..length - 2);
                peer.delete(&doc, at, rng.gen_range(1..3));
            } else {
                let at = rng.gen_range(0..=length);
                peer.type_at(&doc, at, &format!("{round} "));
            }
            if rng.gen_bool(0.5) {
                peers[rng.gen_range(0..3)].release();
            }
        }
        for _ in 0..2 {
            for peer in &mut peers {
                peer.release();
            }
        }
        let expected = mock.doc_text(&doc);
        for peer in &mut peers {
            assert_eq!(
                peer.text(&doc),
                expected,
                "{format:?} applied_version={applied_version}"
            );
        }
    }
}

#[tokio::test]
async fn mock_applies_a_held_update_after_its_sender_has_gone() {
    for format in [DocFormat::ShareJs, DocFormat::HistoryOt] {
        let mock = MockOverleaf::start(project().format(format)).await;
        let doc = mock.doc_id("main.tex");
        let before = mock.doc_text(&doc);
        let mut alice = mock.peer("alice");
        let mut bob = mock.peer("bob");
        alice.join(&doc);
        bob.join(&doc);
        mock.hold_updates();
        alice.type_at(&doc, 0, "sent ");
        alice.drop_connection();
        mock.release_updates();
        let after = format!("sent {before}");
        assert_eq!(mock.doc_text(&doc), after, "{format:?}");
        bob.release();
        assert_eq!(bob.text(&doc), after, "{format:?}");
    }
}

#[tokio::test]
async fn a_mock_peer_keeps_typing_at_its_caret_while_others_edit_around_it() {
    let before = "% ☕ before\n";
    for format in [DocFormat::ShareJs, DocFormat::HistoryOt] {
        let mock = MockOverleaf::start(project().format(format)).await;
        let doc = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        let mut bob = mock.peer("bob");
        alice.join(&doc);
        bob.join(&doc);
        assert!(bob.place_caret_after(&doc, "Hello"));
        assert!(!bob.place_caret_after(&doc, "Goodbye"));
        bob.type_at_caret(&doc, "B");
        alice.type_at(&doc, 0, before);
        bob.type_at_caret(&doc, "O");
        let bobs_o = alice.text(&doc).encode_utf16().count() - 1;
        alice.type_at(&doc, bobs_o, "O");
        bob.type_at_caret(&doc, "B");

        bob.hold();
        bob.type_at_caret(&doc, "!");
        alice.delete(&doc, 0, before.encode_utf16().count());
        bob.type_at_caret(&doc, "?");
        bob.release();

        mock.hold_updates();
        alice.type_at(&doc, 0, "%\n");
        bob.type_at_caret(&doc, "#");
        mock.release_updates();
        bob.type_at_caret(&doc, "~");

        let end = alice.text(&doc).encode_utf16().count();
        alice.type_at(&doc, end, " after");
        bob.type_at_caret(&doc, ".");
        for _ in 0..2 {
            alice.release();
            bob.release();
        }
        let text = mock.doc_text(&doc);
        assert_eq!(
            text, "%\n\\documentclass{article}\nHelloBOOB!?#~. after",
            "{format:?}"
        );
        assert_eq!(alice.text(&doc), text, "{format:?}");
        assert_eq!(bob.text(&doc), text, "{format:?}");
    }
}

#[tokio::test]
async fn mock_counts_a_join_as_settled_once_the_users_list_went_out() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let alice = mock.user("alice").id;
    let mut peer = mock.peer("alice");
    peer.join(&doc);
    assert!(
        !mock.has_joined_and_listed_users(&alice, &doc),
        "joined, but the connected users were never asked for"
    );
    peer.emit("clientTracking.getConnectedUsers", vec![]);
    assert!(mock.has_joined_and_listed_users(&alice, &doc));
    assert!(!mock.has_joined_and_listed_users(&alice, &mock.doc_id("sections/other.tex")));
}

#[tokio::test]
async fn mock_presence_broadcasts_positions_and_lists_connected_users() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    let mut bob = mock.peer("bob");
    alice.join(&doc);
    alice.emit(
        "clientTracking.updatePosition",
        vec![json!({ "row": 1, "column": 2, "doc_id": doc })],
    );
    let moved = bob.events("clientTracking.clientUpdated").remove(0)[0].clone();
    assert_eq!(moved["id"], json!(alice.public_id));
    assert_eq!(moved["name"], "Alice Tester");
    assert_eq!(
        alice.events("clientTracking.clientUpdated").len(),
        1,
        "the sender gets its own update too"
    );
    let users = bob
        .emit("clientTracking.getConnectedUsers", vec![])
        .unwrap();
    let listed = users[1].as_array().unwrap();
    assert_eq!(listed.len(), 2);
    assert!(listed
        .iter()
        .any(|user| user["cursorData"] == json!({ "row": 1, "column": 2, "doc_id": doc })));
    bob.emit(
        "clientTracking.updatePosition",
        vec![json!({ "row": 0, "selection": 4 })],
    );
    assert!(!bob.is_connected(), "an unknown position key disconnects");
}

#[tokio::test]
async fn mock_sends_server_pings_to_websocket_clients_that_ask_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.server_ping = Some(Duration::from_millis(50)));
    let cookie = mock.user("alice").cookie();
    let mut asking = Socket::open_with(
        &mock,
        &cookie,
        &mock.project_id(),
        Kind::WebSocket,
        "&esh=1&ssp=1",
    )
    .await;
    let mut silent = Socket::open(&mock, "bob", Kind::WebSocket).await;
    silent.event("joinProjectResponse").await;
    let first = asking.event("serverPing").await;
    let second = asking.event("serverPing").await;
    let ce = probe_event("server-ping", "websocket", "serverPing").unwrap();
    assert_eq!(kinds(&first), kinds(&ce));
    assert_eq!(
        (first[0].clone(), second[0].clone(), first[2].clone()),
        (json!(0), json!(1), json!("websocket"))
    );
    assert_eq!(silent.quiet_for(Duration::from_millis(200)).await, None);
}

#[tokio::test]
async fn mock_records_client_pongs() {
    let mock = MockOverleaf::start(project()).await;
    let (mut socket, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    mock.server_ping();
    let ping = socket.event("serverPing").await;
    let mut args = ping.clone();
    args.extend([json!("websocket"), ping[3].clone()]);
    socket.send(&event("clientPong", &args)).await;
    eventually(|| mock.received("clientPong").len() == 1).await;
    assert_eq!(mock.received("clientPong")[0].args, args);
}

#[tokio::test]
async fn mock_reconnect_gracefully_reaches_every_client_and_keeps_them_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let (mut ws, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    let (mut polled, _) = Socket::joined(&mock, "bob", Kind::Polling).await;
    mock.reconnect_gracefully();
    let ce = probe_frames("reconnect-gracefully", "xhr-polling")
        .into_iter()
        .find(|frame| frame.raw.contains("reconnectGracefully"))
        .unwrap()
        .raw;
    assert_eq!(ws.next().await, ce);
    assert_eq!(polled.next().await, ce);
    assert_eq!(mock.connections().len(), 2);
}

#[tokio::test]
async fn mock_force_disconnect_sends_message_and_delay_and_keeps_the_socket_open_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let (mut socket, _) = Socket::joined(&mock, "alice", Kind::WebSocket).await;
    let ce = probe_event("force-disconnect", "xhr-polling", "forceDisconnect").unwrap();
    mock.force_disconnect(ce[0].as_str().unwrap(), 2);
    assert_eq!(socket.event("forceDisconnect").await, ce);
    assert_eq!(socket.quiet_for(Duration::from_millis(300)).await, None);
    assert_eq!(mock.connections().len(), 1);
}

#[tokio::test]
async fn mock_project_page_carries_meta_tags_and_drops_ws_url_on_fallback() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.ws_url = Some("https://ws.example.test/socket.io".into()));
    let cookie = mock.user("alice").cookie();
    let page = http()
        .get(url(&mock, ""))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    for meta in [
        "ol-csrfToken",
        "ol-user_id",
        "ol-maxDocLength",
        "ol-maxReconnectGracefullyIntervalMs",
        "ol-otMigrationStage",
    ] {
        assert!(page.contains(&format!("name=\"{meta}\"")), "{meta}");
    }
    assert!(page.contains("content=\"https://ws.example.test/socket.io\""));
    let fallback = http()
        .get(url(&mock, "?ws=fallback"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(!fallback.contains("ol-wsUrl"));
}

fn ce_reply(probe: &str, route: &str, index: usize) -> Value {
    probe_requests(probe, |found| found.contains(route)).swap_remove(index)
}

#[tokio::test]
async fn mock_rest_without_a_session_is_unauthorized_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    for (path, route, index) in [("", "/project/", 2), ("/entities", "/entities", 0)] {
        let reply = http().get(url(&mock, path)).send().await.unwrap();
        let ce = ce_reply("rest-refusals", route, index);
        assert_eq!(
            u64::from(reply.status().as_u16()),
            ce["status"].as_u64().unwrap(),
            "{path}"
        );
        assert_eq!(reply.text().await.unwrap(), ce["body"]);
    }
}

#[tokio::test]
async fn mock_rest_write_without_the_token_is_forbidden_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let reply = http()
        .post(url(&mock, "/doc"))
        .header("Cookie", mock.user("alice").cookie())
        .json(&json!({ "name": "x.tex", "parent_folder_id": mock.root_folder_id() }))
        .send()
        .await
        .unwrap();
    let ce = ce_reply("rest-refusals", "/doc", 0);
    assert_eq!(
        u64::from(reply.status().as_u16()),
        ce["status"].as_u64().unwrap()
    );
    assert_eq!(reply.text().await.unwrap(), ce["body"]);
}

#[tokio::test]
async fn mock_rest_write_from_a_viewer_is_restricted_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let reply = http()
        .post(url(&mock, "/doc"))
        .header("Cookie", mock.user("dave").cookie())
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "name": "x.tex", "parent_folder_id": mock.root_folder_id() }))
        .send()
        .await
        .unwrap();
    let ce = ce_reply("rest-refusals", "/doc", 1);
    assert_eq!(
        u64::from(reply.status().as_u16()),
        ce["status"].as_u64().unwrap()
    );
    assert_eq!(reply.json::<Value>().await.unwrap(), ce["body"]);
}

async fn create_doc(mock: &MockOverleaf, name: &str) -> reqwest::Response {
    http()
        .post(url(mock, "/doc"))
        .header("Cookie", mock.user("alice").cookie())
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "name": name, "parent_folder_id": mock.root_folder_id() }))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn mock_rest_rate_limits_doc_creation_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let ce = probe_http("rest-rate-limited", "/doc");
    let allowed = ce["attempt"].as_u64().unwrap() - 1;
    for n in 0..allowed {
        assert_eq!(create_doc(&mock, &format!("d{n}.tex")).await.status(), 200);
    }
    let limited = create_doc(&mock, "one-too-many.tex").await;
    assert_eq!(limited.status(), 429);
    assert!(
        limited.headers().get("retry-after").is_none(),
        "CE sends no Retry-After"
    );
    assert_eq!(limited.text().await.unwrap(), ce["body"]);
    mock.configure(|config| config.retry_after = Some(60));
    let with_hint = create_doc(&mock, "still-too-many.tex").await;
    assert_eq!(with_hint.headers()["retry-after"], "60");
}

#[tokio::test]
async fn mock_rest_can_lose_a_reply_after_applying_it() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("bob");
    mock.plan_fault(
        Some("POST"),
        &format!("/project/{}/doc", mock.project_id()),
        Fault::LoseReply,
    );
    let lost = http()
        .post(url(&mock, "/doc"))
        .header("Cookie", mock.user("alice").cookie())
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "name": "lost.tex", "parent_folder_id": mock.root_folder_id() }))
        .send()
        .await;
    assert!(lost.is_err(), "the reply never arrives");
    assert!(
        mock.entity_id("lost.tex").is_some(),
        "but the doc was created"
    );
    assert_eq!(watcher.events("reciveNewDoc").len(), 1);
    assert_eq!(
        create_doc(&mock, "next.tex").await.status(),
        200,
        "the fault is one-shot"
    );
}

#[tokio::test]
async fn mock_serves_downloads_chunked_like_ce_unless_asked_for_a_length() {
    let bytes = b"\x89PNG\r\n\x1a\nchunked";
    let mock = MockOverleaf::start(project().file("plot.png", bytes)).await;
    let id = mock.entity_id("plot.png").unwrap();
    let fetch = || async {
        http()
            .get(url(&mock, &format!("/file/{id}")))
            .header("Cookie", mock.user("alice").cookie())
            .send()
            .await
            .unwrap()
    };
    let chunked = fetch().await;
    assert_eq!(chunked.headers()["transfer-encoding"], "chunked");
    assert!(chunked.content_length().is_none(), "CE sends no length");
    assert_eq!(chunked.bytes().await.unwrap().as_ref(), bytes);
    mock.configure(|config| config.download_length = true);
    let measured = fetch().await;
    assert_eq!(measured.content_length(), Some(bytes.len() as u64));
    assert!(measured.headers().get("transfer-encoding").is_none());
    assert_eq!(measured.bytes().await.unwrap().as_ref(), bytes);
}

#[tokio::test]
async fn mock_can_hold_room_events_until_released() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("bob");
    mock.hold_room_events();
    assert_eq!(create_doc(&mock, "late.tex").await.status(), 200);
    assert!(mock.entity_id("late.tex").is_some(), "the doc exists");
    assert!(
        watcher.events("reciveNewDoc").is_empty(),
        "but nobody heard about it"
    );
    mock.release_room_events();
    assert_eq!(watcher.events("reciveNewDoc").len(), 1);
    assert_eq!(create_doc(&mock, "next.tex").await.status(), 200);
    assert_eq!(
        watcher.events("reciveNewDoc").len(),
        2,
        "room events flow again"
    );
}

#[tokio::test]
async fn mock_rest_can_delay_a_reply_past_a_timeout() {
    let mock = MockOverleaf::start(project()).await;
    mock.plan_fault(
        Some("GET"),
        &format!("/project/{}/entities", mock.project_id()),
        Fault::Delay(Duration::from_millis(500)),
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(100))
        .build()
        .unwrap();
    let slow = client
        .get(url(&mock, "/entities"))
        .header("Cookie", mock.user("alice").cookie())
        .send()
        .await;
    assert!(slow.unwrap_err().is_timeout());
    let fast = client
        .get(url(&mock, "/entities"))
        .header("Cookie", mock.user("alice").cookie())
        .send()
        .await
        .unwrap();
    assert_eq!(fast.status(), 200);
}

#[tokio::test]
async fn mock_rest_can_fail_one_request_with_a_status() {
    let mock = MockOverleaf::start(project()).await;
    mock.plan_fault(
        None,
        &format!("/project/{}/entities", mock.project_id()),
        Fault::Reply(403, "Forbidden".into()),
    );
    let cookie = mock.user("alice").cookie();
    let failed = http()
        .get(url(&mock, "/entities"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(failed.status(), 403);
    let ok = http()
        .get(url(&mock, "/entities"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);
    mock.plan_fault(
        None,
        "/socket.io/1/",
        Fault::Reply(429, RATE_LIMITED.into()),
    );
    mock.configure(|config| config.retry_after = Some(15));
    let handshake = http()
        .get(format!(
            "{}/socket.io/1/?projectId={}",
            mock.base,
            mock.project_id()
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(handshake.status(), 429);
    assert_eq!(handshake.headers()["retry-after"], "15");
}

#[tokio::test]
async fn mock_history_routes_answer_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let doc = mock.doc_id("main.tex");
    let mut alice = mock.peer("alice");
    alice.join(&doc);
    alice.type_at(&doc, 0, "edit ");
    let cookie = mock.user("alice").cookie();
    let updates: Value = http()
        .get(url(&mock, "/updates?min_count=3"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ce_updates = ce_reply("rest-reads", "/updates", 0)["body"].clone();
    assert_eq!(keys(&updates), keys(&ce_updates));
    assert_eq!(
        keys(&updates["updates"][0]),
        keys(&ce_updates["updates"][0])
    );
    assert_eq!(
        keys(&updates["updates"][0]["meta"]),
        keys(&ce_updates["updates"][0]["meta"])
    );
    assert_eq!(updates["updates"][0]["pathnames"], json!(["main.tex"]));
    let diff: Value = http()
        .get(url(&mock, "/filetree/diff?from=0&to=1"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ce_diff = ce_reply("rest-reads", "/filetree/diff", 0)["body"]["diff"].clone();
    let shapes = |entries: &Value| -> BTreeSet<BTreeSet<String>> {
        entries.as_array().unwrap().iter().map(keys).collect()
    };
    assert_eq!(shapes(&diff["diff"]), shapes(&ce_diff));
    assert!(diff["diff"]
        .as_array()
        .unwrap()
        .contains(&json!({ "pathname": "main.tex", "operation": "edited" })));
    assert!(diff["diff"]
        .as_array()
        .unwrap()
        .contains(&json!({ "pathname": "figure.png", "editable": false })));
}

#[tokio::test]
async fn mock_history_returns_402_when_configured() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.history_status = 402);
    let cookie = mock.user("alice").cookie();
    for path in ["/updates", "/filetree/diff?from=0&to=1"] {
        let reply = http()
            .get(url(&mock, path))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap();
        assert_eq!(reply.status(), 402, "{path}");
    }
}

#[tokio::test]
async fn mock_tree_routes_change_the_tree_and_tell_the_room() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("bob");
    let cookie = mock.user("alice").cookie();
    let created: Value = create_doc(&mock, "new.tex").await.json().await.unwrap();
    let new_doc = created["_id"].as_str().unwrap().to_string();
    assert_eq!(
        watcher.events("reciveNewDoc")[0][1],
        json!({ "_id": new_doc, "name": "new.tex" })
    );
    let folder: Value = http()
        .post(url(&mock, "/folder"))
        .header("Cookie", &cookie)
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "name": "figures", "parent_folder_id": mock.root_folder_id() }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(watcher.events("reciveNewFolder")[0][1]["name"], "figures");
    let write = |method: reqwest::Method, path: String, body: Option<Value>| {
        let request = http()
            .request(method, url(&mock, &path))
            .header("Cookie", &cookie)
            .header("X-Csrf-Token", MOCK_CSRF);
        match body {
            Some(body) => request.json(&body).send(),
            None => request.send(),
        }
    };
    let renamed = write(
        reqwest::Method::POST,
        format!("/doc/{new_doc}/rename"),
        Some(json!({ "name": "renamed.tex" })),
    )
    .await
    .unwrap();
    assert_eq!(renamed.status(), 204);
    assert_eq!(
        watcher.events("reciveEntityRename")[0],
        vec![json!(new_doc), json!("renamed.tex")]
    );
    write(
        reqwest::Method::POST,
        format!("/doc/{new_doc}/move"),
        Some(json!({ "folder_id": folder["_id"] })),
    )
    .await
    .unwrap();
    assert_eq!(mock.entity_id("figures/renamed.tex"), Some(new_doc.clone()));
    assert_eq!(watcher.events("reciveEntityMove")[0][0], json!(new_doc));
    write(reqwest::Method::DELETE, format!("/doc/{new_doc}"), None)
        .await
        .unwrap();
    assert_eq!(
        watcher.events("removeEntity")[0],
        vec![json!(new_doc), json!("editor")]
    );
    assert_eq!(mock.entity_id("figures/renamed.tex"), None);
}

#[tokio::test]
async fn mock_upload_makes_text_a_doc_and_binary_a_file() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("bob");
    let cookie = mock.user("alice").cookie();
    let upload = |name: &str, bytes: &[u8]| {
        let mut body =
            b"--XyZ\r\nContent-Disposition: form-data; name=\"qqfile\"; filename=\"".to_vec();
        body.extend_from_slice(name.as_bytes());
        body.extend_from_slice(b"\"\r\nContent-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n--XyZ--\r\n");
        http()
            .post(url(
                &mock,
                &format!("/upload?folder_id={}", mock.root_folder_id()),
            ))
            .header("Cookie", &cookie)
            .header("X-Csrf-Token", MOCK_CSRF)
            .header("Content-Type", "multipart/form-data; boundary=XyZ")
            .body(body)
            .send()
    };
    let text: Value = upload("notes.txt", b"plain words")
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(text["entity_type"], "doc");
    assert_eq!(
        mock.doc_text(text["entity_id"].as_str().unwrap()),
        "plain words"
    );
    let image: Value = upload("photo.png", b"\x89PNG\x00binary")
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(image["entity_type"], "file");
    assert_eq!(watcher.events("reciveNewFile").len(), 1);
    let emoji: Value = upload("emoji.tex", "smile \u{1F600}".as_bytes())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        emoji["entity_type"], "file",
        "non-BMP text becomes a binary file"
    );
    for path in [
        format!("/blob/{}", image["hash"].as_str().unwrap()),
        format!("/file/{}", image["entity_id"].as_str().unwrap()),
    ] {
        let bytes = http()
            .get(url(&mock, &path))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), b"\x89PNG\x00binary", "{path}");
    }
}

#[tokio::test]
async fn mock_entities_members_threads_and_messages_answer_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let cookie = mock.user("alice").cookie();
    let get = |path: &str| {
        http()
            .get(url(&mock, path))
            .header("Cookie", &cookie)
            .send()
    };
    let entities: Value = get("/entities").await.unwrap().json().await.unwrap();
    let ce_entities = ce_reply("rest-reads", "/entities", 0)["body"].clone();
    assert_eq!(keys(&entities), keys(&ce_entities));
    assert_eq!(
        keys(&entities["entities"][0]),
        keys(&ce_entities["entities"][0])
    );
    let paths: Vec<&str> = entities["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entity| entity["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        paths,
        vec!["/figure.png", "/main.tex", "/sections/other.tex"]
    );
    let members: Value = get("/members").await.unwrap().json().await.unwrap();
    let ce_members = ce_reply("rest-reads", "/members", 0)["body"].clone();
    assert_eq!(
        keys(&members["members"][0]),
        keys(&ce_members["members"][0])
    );
    assert_eq!(members["members"].as_array().unwrap().len(), 4);
    let threads = get("/threads").await.unwrap();
    assert_eq!(
        u64::from(threads.status().as_u16()),
        ce_reply("rest-reads", "/threads", 0)["status"]
            .as_u64()
            .unwrap()
    );
    let messages = get("/messages?limit=5").await.unwrap();
    assert_eq!(
        u64::from(messages.status().as_u16()),
        ce_reply("rest-reads", "/messages", 0)["status"]
            .as_u64()
            .unwrap()
    );
    assert_eq!(messages.json::<Value>().await.unwrap(), json!([]));
}

fn ce_room_events(probe: &str) -> Vec<(String, Vec<Value>)> {
    probe_frames(probe, "websocket")
        .iter()
        .filter(|frame| !frame.outgoing)
        .filter_map(|frame| codec::decode(&frame.raw).ok()?.into_event())
        .filter(|(name, _)| {
            !matches!(
                name.as_str(),
                "joinProjectResponse"
                    | "serverPing"
                    | "clientTracking.clientUpdated"
                    | "otUpdateApplied"
            )
        })
        .collect()
}

fn upload_body(name: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body =
        b"--XyZ\r\nContent-Disposition: form-data; name=\"qqfile\"; filename=\"".to_vec();
    body.extend_from_slice(name.as_bytes());
    body.extend_from_slice(b"\"\r\nContent-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n--XyZ--\r\n");
    body
}

#[tokio::test]
async fn mock_project_settings_announce_each_change_like_ce() {
    let mock = MockOverleaf::start(project().doc("refs.bib", "@book{knuth,}\n")).await;
    let mut watcher = mock.peer("bob");
    let intro = mock.doc_id("sections/other.tex");
    let main = mock.doc_id("main.tex");
    let refs = mock.doc_id("refs.bib");
    let not_a_bibliography = http()
        .post(url(&mock, "/settings"))
        .header("Cookie", mock.user("alice").cookie())
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "mainBibliographyDocId": main }))
        .send()
        .await
        .unwrap();
    assert_eq!(not_a_bibliography.status(), 500);
    watcher.sync();
    assert!(watcher.events("mainBibliographyDocUpdated").is_empty());
    let changed = http()
        .post(url(&mock, "/settings"))
        .header("Cookie", mock.user("alice").cookie())
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({
            "compiler": "xelatex",
            "name": "demo (settings probe)",
            "spellCheckLanguage": "de",
            "rootDocId": intro,
            "mainBibliographyDocId": refs,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(changed.status(), 204);
    let names = [
        "compilerUpdated",
        "projectNameUpdated",
        "spellCheckLanguageUpdated",
        "rootDocUpdated",
        "mainBibliographyDocUpdated",
    ];
    watcher.sync();
    let ce: Vec<String> = ce_room_events("settings-events")
        .into_iter()
        .map(|(name, _)| name)
        .take(5)
        .collect();
    assert_eq!(ce, names);
    for name in names {
        assert_eq!(watcher.events(name).len(), 1, "{name}");
    }
    assert_eq!(watcher.events("compilerUpdated")[0], vec![json!("xelatex")]);
    assert_eq!(watcher.events("rootDocUpdated")[0], vec![json!(intro)]);
    let join = mock
        .peer("carol")
        .emit("clientTracking.getConnectedUsers", vec![]);
    assert!(join.is_some());
    let viewer = http()
        .post(url(&mock, "/settings"))
        .header("Cookie", mock.user("dave").cookie())
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "compiler": "lualatex" }))
        .send()
        .await
        .unwrap();
    assert_eq!(viewer.status(), 403);
}

#[tokio::test]
async fn mock_uploads_replace_and_convert_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("bob");
    let cookie = mock.user("alice").cookie();
    let upload = |name: &str, bytes: &[u8]| {
        http()
            .post(url(
                &mock,
                &format!("/upload?folder_id={}", mock.root_folder_id()),
            ))
            .header("Cookie", &cookie)
            .header("X-Csrf-Token", MOCK_CSRF)
            .header("Content-Type", "multipart/form-data; boundary=XyZ")
            .body(upload_body(name, bytes))
            .send()
    };
    let doc = http()
        .post(url(&mock, "/doc"))
        .header("Cookie", &cookie)
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "name": "convert.tex", "parent_folder_id": mock.root_folder_id() }))
        .send()
        .await
        .unwrap();
    assert_eq!(doc.status(), 200);
    upload("convert.tex", b"\x89PNG\x00one").await.unwrap();
    upload("convert.tex", b"text again").await.unwrap();
    upload("convert.png", b"\x89PNG\x00two").await.unwrap();
    upload("convert.png", b"\x89PNG\x00three").await.unwrap();
    watcher.sync();
    let tree = |events: Vec<(String, Vec<Value>)>| -> Vec<String> {
        events
            .into_iter()
            .filter(|(name, _)| name.starts_with("recive") || name == "removeEntity")
            .map(|(name, args)| {
                let source = if name == "removeEntity" {
                    &args[1]
                } else {
                    &args[2]
                };
                format!("{name}:{}", source.as_str().unwrap_or_default())
            })
            .collect()
    };
    let expected = vec![
        "reciveNewDoc:editor",
        "removeEntity:convertDocToFile",
        "reciveNewFile:upload",
        "removeEntity:convertFileToDoc",
        "reciveNewDoc:upload",
        "reciveNewFile:upload",
        "removeEntity:upload",
        "reciveNewFile:upload",
    ];
    assert_eq!(
        tree(ce_room_events("upload-replace-and-convert"))[..8],
        expected
    );
    let seen: Vec<(String, Vec<Value>)> = ["reciveNewDoc", "reciveNewFile", "removeEntity"]
        .iter()
        .flat_map(|name| {
            watcher
                .events(name)
                .into_iter()
                .map(move |args| (name.to_string(), args))
        })
        .collect();
    let mut ours = tree(seen);
    ours.sort();
    let mut wanted = expected.iter().map(ToString::to_string).collect::<Vec<_>>();
    wanted.sort();
    assert_eq!(ours, wanted);
    assert!(mock.entity_id("convert.tex").is_some());
    assert_eq!(mock.doc_text(&mock.doc_id("convert.tex")), "text again");
    let refreshed = upload("convert.tex", b"newer text").await.unwrap();
    let refreshed: Value = refreshed.json().await.unwrap();
    assert_eq!(refreshed["entity_id"], json!(mock.doc_id("convert.tex")));
    assert_eq!(mock.doc_text(&mock.doc_id("convert.tex")), "newer text");
}

#[tokio::test]
async fn mock_access_changes_announce_like_ce() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("bob");
    let dave = mock.user("dave").id;
    mock.set_privilege("dave", Some(Privilege::Review));
    mock.set_privilege("dave", Some(Privilege::ReadOnly));
    watcher.sync();
    let ce: Vec<(String, Vec<Value>)> = ce_room_events("collaborator-access-change");
    let ce_dave = probe("collaborator-access-change")["steps"][0]["request"]["route"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    assert_eq!(
        ce,
        vec![
            (
                "project:collaboratorAccessLevel:changed".to_string(),
                vec![json!({ "userId": ce_dave })]
            ),
            (
                "project:collaboratorAccessLevel:changed".to_string(),
                vec![json!({ "userId": ce_dave })]
            ),
        ]
    );
    assert_eq!(
        watcher.events("project:collaboratorAccessLevel:changed"),
        vec![
            vec![json!({ "userId": dave })],
            vec![json!({ "userId": dave })]
        ]
    );
    assert!(watcher.events("project:membership:changed").is_empty());
    let erin = mock.user("erin").id;
    mock.set_privilege("erin", None);
    mock.set_privilege("dave", None);
    mock.set_privilege("zed", None);
    watcher.sync();
    assert_eq!(
        watcher.events("userRemovedFromProject"),
        vec![vec![json!(erin)], vec![json!(dave)]]
    );
    assert_eq!(watcher.events("project:membership:changed").len(), 2);
    mock.set_privilege("dave", Some(Privilege::ReadAndWrite));
    mock.set_track_changes(json!({ dave.clone(): true }));
    watcher.sync();
    assert_eq!(watcher.events("project:membership:changed").len(), 3);
    assert_eq!(
        watcher.events("toggle-track-changes"),
        vec![vec![json!({ dave: true })]]
    );
}

#[tokio::test]
async fn mock_invite_accepts_announce_once_like_ce() {
    let mock =
        MockOverleaf::start(project().invited("zed@example.test", Privilege::ReadOnly)).await;
    let mut watcher = mock.peer("bob");
    let accepted = (
        "project:membership:changed".to_string(),
        vec![json!({ "invites": true, "members": true })],
    );
    assert!(ce_room_events("people-invites").contains(&accepted));
    mock.accept_invite("zed@example.test", "zed");
    assert_eq!(
        watcher.events("project:membership:changed"),
        vec![accepted.1]
    );
    assert!(watcher
        .events("project:collaboratorAccessLevel:changed")
        .is_empty());
    assert_eq!(mock.privilege_of("zed"), Some(Privilege::ReadOnly));
    assert_eq!(mock.invite_token("zed@example.test"), None);
}

#[tokio::test]
async fn mock_link_viewers_get_the_restricted_join_like_ce() {
    let mock = MockOverleaf::start(project().token_viewer(MockUser::named("tess"))).await;
    let mut tess = mock.peer("tess");
    let join = tess.events("joinProjectResponse").remove(0).remove(0);
    let ce = probe_frames("restricted-link-join", "websocket")
        .iter()
        .filter(|frame| !frame.outgoing)
        .find_map(
            |frame| match codec::decode(&frame.raw).ok()?.into_event()? {
                (name, mut args) if name == "joinProjectResponse" => Some(args.remove(0)),
                _ => None,
            },
        )
        .unwrap();
    assert_eq!(join["permissionsLevel"], ce["permissionsLevel"]);
    let keys = |value: &Value| {
        value
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>()
    };
    assert_eq!(
        keys(&join["project"]["owner"]),
        keys(&ce["project"]["owner"])
    );
    assert_eq!(join["project"]["members"], ce["project"]["members"]);
    assert_eq!(join["project"]["invites"], ce["project"]["invites"]);
    let members = http()
        .get(url(&mock, "/members"))
        .header("Cookie", mock.user("tess").cookie())
        .send()
        .await
        .unwrap();
    assert_eq!(members.status(), 403);
    let ce_members = probe_http("restricted-link-join", "/members");
    assert_eq!(ce_members["status"], 403);
    assert_eq!(members.json::<Value>().await.unwrap(), ce_members["body"]);
    let owner_view = mock
        .peer("bob")
        .events("joinProjectResponse")
        .remove(0)
        .remove(0);
    assert!(owner_view["project"]["owner"]["email"].is_string());
}

#[tokio::test]
async fn a_configured_login_signs_in_lists_the_project_and_downloads_it() {
    let mock = MockOverleaf::start(project()).await;
    let login = format!("{}/login", mock.base);
    assert_eq!(http().get(&login).send().await.unwrap().status(), 404);
    mock.configure(|config| config.sign_in_as = Some("bob".into()));
    let signed = http().get(&login).send().await.unwrap();
    assert_eq!(signed.status(), 302);
    assert_eq!(signed.headers()["location"], "/project");
    let cookie = signed.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert_eq!(cookie, mock.user("bob").cookie());
    let dashboard = |cookie: String| {
        let base = mock.base.clone();
        async move {
            http()
                .get(format!("{base}/project"))
                .header("cookie", cookie)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        }
    };
    let listed = dashboard(cookie.clone()).await;
    assert!(listed.contains(&mock.project_id()));
    assert!(listed.contains("readAndWrite"));
    assert!(!dashboard(mock.user("zed").cookie())
        .await
        .contains(&mock.project_id()));
    let bytes = http()
        .get(url(&mock, "/download/zip"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).unwrap();
    let mut names: Vec<String> = archive
        .file_names()
        .map(|name| name.unwrap().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["figure.png", "main.tex", "sections/other.tex"]);
    let mut main = String::new();
    std::io::Read::read_to_string(&mut archive.by_name("main.tex").unwrap(), &mut main).unwrap();
    assert_eq!(main, "\\documentclass{article}\nHello");
}

type Heard = Vec<(String, Vec<Value>)>;

fn heard(peer: &mut MockPeer) -> Heard {
    peer.sync();
    std::mem::take(&mut peer.events)
        .into_iter()
        .filter(|(name, _)| name != "serverPing" && !name.starts_with("clientTracking"))
        .collect()
}

fn ce_heard(step: &Value, who: &str) -> Heard {
    step["events"][who]
        .as_array()
        .into_iter()
        .flatten()
        .map(|event| {
            (
                event["name"].as_str().unwrap().to_string(),
                event["args"].as_array().unwrap().clone(),
            )
        })
        .collect()
}

fn names(events: &Heard) -> Vec<&str> {
    events.iter().map(|(name, _)| name.as_str()).collect()
}

fn swapped(value: &Value, ids: &BTreeMap<String, String>) -> Value {
    match value {
        Value::String(text) => {
            Value::String(ids.get(text).cloned().unwrap_or_else(|| text.clone()))
        }
        Value::Array(items) => Value::Array(items.iter().map(|item| swapped(item, ids)).collect()),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, item)| (key.clone(), swapped(item, ids)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn ce_entity_paths(name: &str) -> BTreeMap<String, String> {
    fn walk(folder: &Value, prefix: &str, paths: &mut BTreeMap<String, String>) {
        for entry in ["docs", "fileRefs"]
            .into_iter()
            .flat_map(|kind| folder[kind].as_array().into_iter().flatten())
        {
            paths.insert(
                entry["_id"].as_str().unwrap().to_string(),
                format!("{prefix}{}", entry["name"].as_str().unwrap()),
            );
        }
        for child in folder["folders"].as_array().into_iter().flatten() {
            let inner = format!("{prefix}{}/", child["name"].as_str().unwrap());
            walk(child, &inner, paths);
        }
    }
    let join = probe_event(name, "websocket", "joinProjectResponse").unwrap();
    let mut paths = BTreeMap::new();
    walk(&join[0]["project"]["rootFolder"][0], "", &mut paths);
    paths
}

async fn as_user(
    mock: &MockOverleaf,
    user: &str,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> (u64, Value) {
    let mut request = http()
        .request(method.parse().unwrap(), url(mock, path))
        .header("Cookie", mock.user(user).cookie())
        .header("X-Csrf-Token", MOCK_CSRF);
    if let Some(body) = body {
        request = request.json(body);
    }
    let reply = request.send().await.unwrap();
    let status = u64::from(reply.status().as_u16());
    let text = reply.text().await.unwrap();
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

#[tokio::test]
async fn mock_history_reads_labels_and_restores_answer_like_ce() {
    const CE: &str = "history-routes";
    let mock = MockOverleaf::start(project()).await;
    let mut bob = mock.peer("bob");
    let parent = json!({ "name": "extra.tex", "parent_folder_id": mock.root_folder_id() });
    let (_, created) = as_user(&mock, "alice", "POST", "/doc", Some(&parent)).await;
    let extra = created["_id"].as_str().unwrap().to_string();
    mock.external_edit(&extra, 0, "Extra file text.\n");
    mock.record_version("alice", "extra.tex");
    as_user(&mock, "alice", "DELETE", &format!("/doc/{extra}"), None).await;
    mock.record_version("alice", "extra.tex");
    heard(&mut bob);

    for (label, path) in [
        (
            "diff of extra.tex at the version where it existed",
            "/diff?from=1&to=1&pathname=extra.tex",
        ),
        (
            "diff of extra.tex after it was deleted",
            "/diff?from=2&to=2&pathname=extra.tex",
        ),
        (
            "diff with an unknown pathname",
            "/diff?from=0&to=2&pathname=nope.tex",
        ),
        ("diff with no pathname", "/diff?from=0&to=2"),
        (
            "diff of a binary (frog.jpg)",
            "/diff?from=2&to=2&pathname=figure.png",
        ),
    ] {
        let ce = probe_step(CE, label);
        let (status, body) = as_user(&mock, "alice", "GET", path, None).await;
        assert_eq!(status, ce["status"], "{label}");
        if status == 200 {
            assert_eq!(body, ce["body"], "{label}");
        }
    }
    let ce_tree = probe_step(CE, "filetree diff over the whole range")["body"]["diff"].clone();
    let entry = |diff: &Value, operation: &str| {
        diff.as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["operation"] == operation)
            .cloned()
            .unwrap_or_else(|| panic!("no {operation} entry in {diff}"))
    };
    let (_, added) = as_user(&mock, "alice", "GET", "/filetree/diff?from=0&to=1", None).await;
    let (_, removed) = as_user(&mock, "alice", "GET", "/filetree/diff?from=1&to=2", None).await;
    assert_eq!(
        keys(&entry(&added["diff"], "added")),
        keys(&entry(&ce_tree, "added"))
    );
    let gone = entry(&removed["diff"], "removed");
    assert_eq!(keys(&gone), keys(&entry(&ce_tree, "removed")));
    assert_eq!(gone["deletedAtV"], 1);

    let mut labels = BTreeMap::new();
    for user in ["alice", "bob", "carol", "dave"] {
        let ce = probe_step(CE, &format!("{user} adds a label"));
        let mut body = ce["request"]["body"].clone();
        body["version"] = json!(2);
        let (status, reply) = as_user(&mock, user, "POST", "/labels", Some(&body)).await;
        assert_eq!(status, ce["status"], "{user}");
        if status == 200 {
            assert_eq!(keys(&reply), keys(&ce["body"]), "{user}");
            labels.insert(user, reply["id"].as_str().unwrap().to_string());
        } else {
            assert_eq!(reply, ce["body"], "{user}");
        }
    }
    for (label, user, owner) in [
        ("bob deletes alice's label", "bob", "alice"),
        ("carol deletes her own label", "carol", "carol"),
        ("alice deletes bob's label", "alice", "bob"),
    ] {
        let route = format!("/labels/{}", labels[owner]);
        let (status, _) = as_user(&mock, user, "DELETE", &route, None).await;
        assert_eq!(status, probe_step(CE, label)["status"], "{label}");
    }
    let (status, _) = as_user(
        &mock,
        "alice",
        "DELETE",
        "/labels/6b04ffcbc0ffee0001000001",
        None,
    )
    .await;
    assert_eq!(
        status,
        probe_step(CE, "alice deletes an unknown label")["status"]
    );
    let comments = |listed: &Value| -> Vec<Value> {
        listed
            .as_array()
            .unwrap()
            .iter()
            .map(|label| label["comment"].clone())
            .collect()
    };
    let (_, left) = as_user(&mock, "alice", "GET", "/labels", None).await;
    assert_eq!(
        comments(&left),
        comments(&probe_step(CE, "labels after deleting")["body"])
    );
    assert_eq!(
        keys(&left[0]),
        keys(&probe_step(CE, "labels after deleting")["body"][0])
    );
    let (_, updates) = as_user(&mock, "alice", "GET", "/updates?min_count=1", None).await;
    let ce_updates = probe_step(CE, "updates carry labels")["body"].clone();
    assert_eq!(
        keys(&updates["updates"][0]["labels"][0]),
        keys(&ce_updates["updates"][0]["labels"][0])
    );

    for (label, user, route, body) in [
        (
            "revert_file main.tex (stock CE project)",
            "alice",
            "/revert_file",
            json!({ "version": 0, "pathname": "main.tex" }),
        ),
        (
            "revert-project (stock CE project)",
            "alice",
            "/revert-project",
            json!({ "version": 0 }),
        ),
        (
            "carol (reviewer) revert_file",
            "carol",
            "/revert_file",
            json!({ "version": 0, "pathname": "main.tex" }),
        ),
        (
            "dave (viewer) restore_file",
            "dave",
            "/restore_file",
            json!({ "version": 1, "pathname": "extra.tex" }),
        ),
        (
            "restore_file of a path not in that version",
            "alice",
            "/restore_file",
            json!({ "version": 1, "pathname": "nope.tex" }),
        ),
    ] {
        let ce = probe_step(CE, label);
        let (status, reply) = as_user(&mock, user, "POST", route, Some(&body)).await;
        assert_eq!(status, ce["status"], "{label}");
        if status == 403 {
            assert_eq!(reply, ce["body"], "{label}");
        }
        assert_eq!(heard(&mut bob), ce_heard(&ce, "bob"), "{label}");
    }

    let ce = probe_step(CE, "restore_file of the deleted extra.tex");
    let body = json!({ "version": 1, "pathname": "extra.tex" });
    let (status, reply) = as_user(&mock, "alice", "POST", "/restore_file", Some(&body)).await;
    assert_eq!(status, ce["status"]);
    assert_eq!(keys(&reply), keys(&ce["body"]));
    let (events, ce_events) = (heard(&mut bob), ce_heard(&ce, "bob"));
    assert_eq!(names(&events), names(&ce_events));
    assert_eq!(events[0].1.len(), ce_events[0].1.len());
    assert_eq!(keys(&events[0].1[1]), keys(&ce_events[0].1[1]));
    assert_eq!(events[0].1[2], ce_events[0].1[2]);

    let ce = probe_step(CE, "restore_file of main.tex over the existing main.tex");
    let body = json!({ "version": 0, "pathname": "main.tex" });
    let (status, _) = as_user(&mock, "alice", "POST", "/restore_file", Some(&body)).await;
    assert_eq!(status, ce["status"]);
    let (events, ce_events) = (heard(&mut bob), ce_heard(&ce, "bob"));
    assert_eq!(names(&events), names(&ce_events));
    for (_, args) in [&events[0], &ce_events[0]] {
        let name = args[1]["name"].as_str().unwrap();
        assert!(
            name.starts_with("main (Restored on ") && name.ends_with(").tex"),
            "{name}"
        );
    }

    mock.configure(|config| config.ranges_support = true);
    let ce = probe_step(CE, "revert_file main.tex (ranges support on)");
    let body = json!({ "version": 0, "pathname": "main.tex" });
    let (status, reply) = as_user(&mock, "alice", "POST", "/revert_file", Some(&body)).await;
    assert_eq!(status, ce["status"]);
    assert_eq!(keys(&reply), keys(&ce["body"]));
    let (events, ce_events) = (heard(&mut bob), ce_heard(&ce, "bob"));
    assert_eq!(names(&events), names(&ce_events));
    assert_eq!(keys(&events[0].1[1]), keys(&ce_events[0].1[1]));
    assert_eq!(events[2].1.len(), ce_events[2].1.len());
    let ce = probe_step(
        CE,
        "revert_file of a path not in that version (ranges support on)",
    );
    let body = json!({ "version": 0, "pathname": "nope.tex" });
    let (status, _) = as_user(&mock, "alice", "POST", "/revert_file", Some(&body)).await;
    assert_eq!(status, ce["status"]);
    assert!(heard(&mut bob).is_empty());

    let ce = probe_step(
        CE,
        "revert-project to the version where extra.tex existed (ranges support on)",
    );
    let (status, reply) = as_user(
        &mock,
        "alice",
        "POST",
        "/revert-project",
        Some(&json!({ "version": 1 })),
    )
    .await;
    assert_eq!(status, ce["status"]);
    for item in reply.as_array().unwrap() {
        assert_eq!(keys(item), keys(&ce["body"][0]));
    }
    let (events, ce_events) = (heard(&mut bob), ce_heard(&ce, "bob"));
    let follows = |events: &Heard, name: &str| -> Vec<String> {
        events
            .windows(2)
            .filter(|pair| pair[1].0 == name)
            .map(|pair| pair[0].0.clone())
            .collect()
    };
    for name in ["reciveNewDoc", "reciveNewFile", "new-comment-threads"] {
        let ce_before: BTreeSet<String> = follows(&ce_events, name).into_iter().collect();
        let before: BTreeSet<String> = follows(&events, name).into_iter().collect();
        assert_eq!(before, ce_before, "{name}");
    }
    let file = |events: &Heard| {
        events
            .iter()
            .find(|(name, _)| name == "reciveNewFile")
            .map(|(_, args)| args.clone())
            .unwrap()
    };
    let (file, ce_file) = (file(&events), file(&ce_events));
    assert_eq!(file.len(), ce_file.len());
    assert_eq!(keys(&file[1]), keys(&ce_file[1]));
    assert_eq!(file[1]["linkedFileData"], ce_file[1]["linkedFileData"]);
    assert_eq!(file[3], ce_file[3]);
    assert_eq!(names(&events).last(), names(&ce_events).last());

    let zip = |version: &str, user: &str| {
        http()
            .get(url(&mock, &format!("/version/{version}/zip")))
            .header("Cookie", mock.user(user).cookie())
            .send()
    };
    let ce_missing = ce_reply(CE, "/version/1023/zip", 0);
    let missing = zip("1023", "alice").await.unwrap();
    assert_eq!(missing.status().as_u16(), ce_missing["status"]);
    let ce_viewer = ce_reply(CE, "/version/23/zip", 1);
    assert_eq!(ce_viewer["request"]["user"], "dave");
    let viewer = zip("2", "dave").await.unwrap();
    assert_eq!(viewer.status().as_u16(), ce_viewer["status"]);
    assert_eq!(
        viewer.headers()["content-type"].to_str().unwrap(),
        ce_viewer["headers"]["content-type"]
    );
}

#[tokio::test]
async fn mock_history_pages_follow_the_next_before_version_like_ce() {
    const CE: &str = "history-paging";
    let updates = |step: &str| probe_step(CE, step)["body"].clone();
    let bounds = |page: &Value| -> Vec<(u64, u64)> {
        page["updates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|update| {
                (
                    update["fromV"].as_u64().unwrap(),
                    update["toV"].as_u64().unwrap(),
                )
            })
            .collect()
    };
    let next = |page: &Value| page.get("nextBeforeTimestamp").and_then(Value::as_u64);
    let check = |first: &Value, older: &Value, everything: &Value, latest: &Value| {
        let next_before = next(first).expect("a first page that says where the next starts");
        assert_eq!(bounds(first).len(), 1);
        assert_eq!(bounds(first).last().unwrap().0, next_before);
        assert_eq!(bounds(older)[0].1, next_before);
        assert_eq!(next(everything), None);
        assert_eq!(bounds(everything)[0].1, bounds(first)[0].1);
        assert_eq!(bounds(latest), bounds(first));
    };
    check(
        &updates("min_count=1"),
        &updates("min_count=1, before=nextBeforeTimestamp"),
        &updates("min_count=500"),
        &updates("min_count=1, before=the latest version"),
    );
    assert_eq!(next(&updates("no min_count (25 by default)")), None);

    let mock = MockOverleaf::start(project()).await;
    for _ in 0..3 {
        mock.external_edit(&mock.doc_id("main.tex"), 0, "x");
        mock.record_version("alice", "main.tex");
    }
    let page = |query: String| {
        let mock = &mock;
        async move {
            as_user(mock, "alice", "GET", &format!("/updates?{query}"), None)
                .await
                .1
        }
    };
    let first = page("min_count=1".into()).await;
    let older = page(format!("min_count=1&before={}", next(&first).unwrap())).await;
    let everything = page("min_count=500".into()).await;
    let latest = page("min_count=1&before=3".into()).await;
    check(&first, &older, &everything, &latest);
    assert_eq!(next(&page(String::new()).await), None);
}

#[tokio::test]
async fn mock_project_settings_answer_each_key_like_ce() {
    const CE: &str = "settings-each-key";
    let mock = MockOverleaf::start(
        MockProject::new("sharejs-project")
            .member(MockUser::named("bob"), Privilege::ReadAndWrite)
            .member(MockUser::named("carol"), Privilege::Review)
            .member(MockUser::named("dave"), Privilege::ReadOnly)
            .doc("main.tex", "\\documentclass{article}\nHello")
            .doc("refs.bib", "@book{knuth,}\n")
            .doc("sections/intro.tex", "Intro"),
    )
    .await;
    let to_mock: BTreeMap<String, String> = ce_entity_paths(CE)
        .into_iter()
        .filter_map(|(id, path)| Some((id, mock.entity_id(&path)?)))
        .collect();
    assert_eq!(to_mock.len(), 3);
    let to_ce: BTreeMap<String, String> = to_mock
        .iter()
        .map(|(ce, ours)| (ours.clone(), ce.clone()))
        .collect();
    let mut bob = mock.peer("bob");
    heard(&mut bob);
    let steps = probe_requests(CE, |route| route.ends_with("/settings"));
    assert_eq!(steps.len(), 28);
    for step in &steps {
        let label = step["label"].as_str().unwrap();
        let user = step["request"]["user"].as_str().unwrap();
        let body = swapped(&step["request"]["body"], &to_mock);
        let (status, _) = as_user(&mock, user, "POST", "/settings", Some(&body)).await;
        assert_eq!(status, step["status"], "{label}");
        let events: Heard = heard(&mut bob)
            .into_iter()
            .map(|(name, args)| (name, args.iter().map(|arg| swapped(arg, &to_ce)).collect()))
            .collect();
        assert_eq!(events, ce_heard(step, "bob"), "{label}");
    }
}

#[tokio::test]
async fn mock_linked_file_refreshes_answer_like_ce() {
    const CE: &str = "linked-files";
    let mock = MockOverleaf::start(project().file("linked.bib", b"@book{old,}")).await;
    let source = json!({ "provider": "project_file", "source_project_id": "6b04ff2fcb4fe3a455d4ddca", "source_entity_path": "/sample.bib" });
    mock.link_file("linked.bib", source, b"@book{new,}");
    let mut bob = mock.peer("bob");
    heard(&mut bob);
    let refresh = |file: String, user: &'static str, body: Value| {
        let mock = &mock;
        async move {
            as_user(
                mock,
                user,
                "POST",
                &format!("/linked_file/{file}/refresh"),
                Some(&body),
            )
            .await
        }
    };
    let linked = mock.entity_id("linked.bib").unwrap();
    for label in [
        "alice refreshes linked.bib after the source changed",
        "alice refreshes it again with {shouldReindexReferences: true}",
    ] {
        let ce = probe_step(CE, label);
        let current = mock.entity_id("linked.bib").unwrap();
        let (status, reply) = refresh(current, "alice", ce["request"]["body"].clone()).await;
        assert_eq!(status, ce["status"], "{label}");
        assert_eq!(keys(&reply), keys(&ce["body"]), "{label}");
        let (events, ce_events) = (heard(&mut bob), ce_heard(&ce, "bob"));
        assert_eq!(names(&events), names(&ce_events), "{label}");
        assert_eq!(events[0].1[1], ce_events[0].1[1], "{label}");
        let (file, ce_file) = (&events[1].1, &ce_events[1].1);
        assert_eq!(file.len(), ce_file.len(), "{label}");
        assert_eq!(keys(&file[1]), keys(&ce_file[1]), "{label}");
        assert_eq!(file[2], ce_file[2], "{label}");
        assert_eq!(
            keys(&file[1]["linkedFileData"]),
            keys(&ce_file[1]["linkedFileData"])
        );
    }
    for (label, file, user) in [
        (
            "alice refreshes the old (replaced) file id",
            linked.clone(),
            "alice",
        ),
        (
            "alice refreshes an unknown id",
            "6b04ff6ac0ffee0001000001".to_string(),
            "alice",
        ),
        (
            "alice refreshes an ordinary file (frog.jpg)",
            mock.entity_id("figure.png").unwrap(),
            "alice",
        ),
        (
            "carol (reviewer) refreshes",
            mock.entity_id("linked.bib").unwrap(),
            "carol",
        ),
        (
            "dave (viewer) refreshes",
            mock.entity_id("linked.bib").unwrap(),
            "dave",
        ),
        (
            "alice refreshes with an unknown body key",
            mock.entity_id("linked.bib").unwrap(),
            "alice",
        ),
    ] {
        let ce = probe_step(CE, label);
        let (status, reply) = refresh(file, user, ce["request"]["body"].clone()).await;
        assert_eq!(status, ce["status"], "{label}");
        if ce["body"].is_object() && status == 403 {
            assert_eq!(reply, ce["body"], "{label}");
        }
        assert!(heard(&mut bob).is_empty(), "{label}");
    }
}

#[tokio::test]
async fn mock_link_grants_answer_like_ce() {
    const CE: &str = "link-sharing-grants";
    let ce_name = probe_step(CE, "erin grants read-only with no confirmedByUser")["body"]
        ["requireAccept"]["projectName"]
        .as_str()
        .unwrap()
        .to_string();
    let mock = MockOverleaf::start(
        MockProject::new(&ce_name)
            .outsider(MockUser::named("dave"))
            .outsider(MockUser::named("erin"))
            .doc("main.tex", "Hello"),
    )
    .await;
    let ce_project = probe(CE)["steps"][0]["body"]["project_id"]
        .as_str()
        .unwrap()
        .to_string();
    let to_ce = BTreeMap::from([(
        format!("/project/{}", mock.project_id()),
        format!("/project/{ce_project}"),
    )]);
    let (read, edit) = mock.share_by_link();
    let read_token = read.rsplit('/').next().unwrap().to_string();
    let edit_token = edit
        .rsplit('/')
        .next()
        .unwrap()
        .split('#')
        .next()
        .unwrap()
        .to_string();
    let mut alice = mock.peer("alice");
    heard(&mut alice);
    let grant = |route: &str, user: &str, body: &Value| {
        let path = route
            .replace("/read/[redacted]/", &format!("/read/{read_token}/"))
            .replace("/[redacted]/", &format!("/{edit_token}/"));
        http()
            .post(format!("{}{path}", mock.base))
            .header("Cookie", mock.user(user).cookie())
            .header("X-Csrf-Token", MOCK_CSRF)
            .json(body)
            .send()
    };
    let steps = probe_requests(CE, |route| route.ends_with("/grant"));
    assert_eq!(steps.len(), 10);
    for step in &steps {
        let label = step["label"].as_str().unwrap_or("unknown token");
        let user = step["request"]["user"].as_str().unwrap();
        let route = step["request"]["route"].as_str().unwrap();
        let reply = grant(route, user, &step["request"]["body"]).await.unwrap();
        assert_eq!(reply.status().as_u16(), step["status"], "{label}");
        if step["body"].is_object() {
            let body: Value = reply.json().await.unwrap();
            assert_eq!(swapped(&body, &to_ce), step["body"], "{label}");
        }
        let events = heard(&mut alice);
        assert_eq!(names(&events), names(&ce_heard(step, "alice")), "{label}");
        if step["label"] == "erin grants read-only confirmedByUser true" {
            for read in [
                "/updates?min_count=1",
                "/labels",
                "/version/1/zip",
                "/messages",
                "/members",
                "/entities",
            ] {
                let ce = ce_reply(CE, read, 0);
                assert_eq!(ce["request"]["user"], "erin (restricted)");
                let (status, body) = as_user(&mock, "erin", "GET", read, None).await;
                assert_eq!(status, ce["status"], "{read}");
                if status == 403 {
                    assert_eq!(body, ce["body"], "{read}");
                }
            }
        }
    }
}

#[tokio::test]
async fn mock_learned_words_answer_like_ce() {
    const CE: &str = "spelling-learned-words";
    let mock = MockOverleaf::start(project()).await;
    let meta =
        |label: &str| probe_step(CE, label)["page"]["meta"]["ol-learnedWords"]["value"].clone();
    assert_eq!(
        json!(mock.learned_words("bob")),
        meta("the editor page before")
    );
    let steps = probe_steps(CE, |step| step.get("request").is_some());
    for step in &steps {
        let label = step["label"].as_str().unwrap();
        let method: reqwest::Method = step["request"]["method"].as_str().unwrap().parse().unwrap();
        let mut request = http().request(
            method,
            format!(
                "{}{}",
                mock.base,
                step["request"]["route"].as_str().unwrap()
            ),
        );
        if let Some(user) = step["request"]["user"].as_str() {
            request = request.header("Cookie", mock.user(user).cookie());
        }
        if !label.contains("without the anti-forgery header") {
            request = request.header("X-Csrf-Token", MOCK_CSRF);
        }
        if let Some(body) = step["request"].get("body") {
            request = request.json(body);
        }
        let reply = request.send().await.unwrap();
        assert_eq!(reply.status().as_u16(), step["status"], "{label}");
        if step["body"].is_object() {
            assert_eq!(
                reply.json::<Value>().await.unwrap(),
                step["body"],
                "{label}"
            );
        }
        let page_after = match label {
            "learn two words with a space" => Some("the editor page after learning"),
            "unlearn a word never learned" => Some("the editor page after unlearning one"),
            "put back: unlearn two words" => Some("the editor page after putting back"),
            _ => None,
        };
        if let Some(page) = page_after {
            assert_eq!(json!(mock.learned_words("bob")), meta(page), "{page}");
        }
    }
}

fn ce_socket(name: &str, user: &str, format: &str) -> Heard {
    probe_socket(name, |socket| {
        socket["user"] == user && socket["format"] == format
    })
    .iter()
    .filter(|frame| !frame.outgoing)
    .filter_map(|frame| match codec::decode(&frame.raw).ok()? {
        Frame::Ack { args, .. } => Some(("ack".to_string(), args)),
        packet => packet.into_event(),
    })
    .collect()
}

#[tokio::test]
async fn mock_restricted_joins_hide_comments_like_ce() {
    const CE: &str = "restricted-join-comments";
    for (format, wire) in [
        (DocFormat::ShareJs, "sharejs-text-ot"),
        (DocFormat::HistoryOt, "history-ot"),
    ] {
        let ce_join = ce_socket(CE, "erin", wire)
            .into_iter()
            .find(|(name, args)| name == "ack" && args.len() >= 5)
            .unwrap()
            .1;
        let ce_kept = probe_steps(CE, |step| step["server"]["format"] == wire)[0]["server"]
            ["ranges"]["comments"]
            .as_array()
            .map_or(0, Vec::len);
        let comments = |reply: &[Value]| -> usize {
            match format {
                DocFormat::ShareJs => reply[4]["comments"].as_array().map_or(0, Vec::len),
                DocFormat::HistoryOt => reply[1]["comments"].as_array().map_or(0, Vec::len),
            }
        };
        let mock = MockOverleaf::start(
            project()
                .token_viewer(MockUser::named("tess"))
                .format(format),
        )
        .await;
        let doc = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        alice.join(&doc);
        alice.comment(&doc, 0, 5, "6b04e0adc0ffee0001000001");
        let mut tess = mock.peer("tess");
        let options = json!({ "encodeRanges": true, "supportsHistoryOT": true });
        let joined = tess
            .emit("joinDoc", vec![json!(doc), options.clone()])
            .unwrap();
        let owner = mock
            .peer("bob")
            .emit("joinDoc", vec![json!(doc), options])
            .unwrap();
        assert_eq!(
            comments(&joined).min(1),
            comments(&ce_join).min(1),
            "{wire}"
        );
        assert!(ce_kept > 0 && comments(&owner) > 0, "{wire}");
        heard(&mut tess);
        alice.comment(&doc, 6, 4, "6b04e0adc0ffee0002000001");
        let applied: Vec<Value> = heard(&mut tess)
            .into_iter()
            .filter(|(name, _)| name == "otUpdateApplied")
            .map(|(_, args)| args[0]["op"].clone())
            .collect();
        let ce_applied: Vec<Value> = ce_socket(CE, "erin", wire)
            .into_iter()
            .filter(|(name, args)| name == "otUpdateApplied" && args[0].get("op").is_some())
            .map(|(_, args)| args[0]["op"].clone())
            .collect();
        assert_eq!(applied.len(), 1, "{wire}");
        assert_eq!(keys(&applied[0][0]), keys(&ce_applied[0][0]), "{wire}");
        let mut tess = mock.peer("tess");
        tess.join(&doc);
        tess.comment(&doc, 0, 3, "6b04e0b4c0ffee0006000001");
        let kept = match format {
            DocFormat::ShareJs => mock.ranges(&doc)["comments"].clone(),
            DocFormat::HistoryOt => mock.raw_doc(&doc)["comments"].clone(),
        };
        assert_eq!(kept.as_array().unwrap().len(), 3, "{wire}");
    }
}
