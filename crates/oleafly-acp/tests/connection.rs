//! The client against a scripted agent on in-memory pipes.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_acp::{AcpClient, ClientHost, ErrorKind, IncomingRequest, NullHost, TurnTiming};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tokio::sync::mpsc;

/// Records every callback, and answers permission requests as cancelled.
#[derive(Default)]
struct RecordingHost {
    log: Mutex<Vec<String>>,
    updates: Mutex<Vec<Value>>,
    cancelled: Mutex<Option<mpsc::UnboundedSender<()>>>,
}

impl RecordingHost {
    fn log(&self) -> Vec<String> {
        self.log.lock().unwrap().clone()
    }
}

impl ClientHost for RecordingHost {
    fn on_update(&self, params: Value) {
        self.log.lock().unwrap().push("update".into());
        self.updates.lock().unwrap().push(params);
    }

    fn on_request(&self, request: IncomingRequest) {
        self.log
            .lock()
            .unwrap()
            .push(format!("request:{}", request.method()));
        if request.method() == "session/request_permission" {
            let _ = request.respond(json!({"outcome": {"outcome": "cancelled"}}));
        } else if request.method() == "fs/read_text_file" {
            // A reply the agent's frame cannot hold.
            let _ = request.respond(json!({"content": "x".repeat(oleafly_acp::limits::MAX_FRAME)}));
        } else if request.method() == "slow/request" {
            let cancelled = request.cancelled();
            let signal = self.cancelled.lock().unwrap().clone();
            tokio::spawn(async move {
                cancelled.await;
                if let Some(signal) = signal {
                    let _ = signal.send(());
                }
                let _ = request.reject(-32800, "cancelled");
            });
        } else {
            let _ = request.reject(-32601, "This client capability is not available.");
        }
    }

    fn on_notification(&self, method: &str, _params: Value) {
        self.log
            .lock()
            .unwrap()
            .push(format!("notification:{method}"));
    }

    fn on_dropped_update(&self, bytes: usize) {
        self.log.lock().unwrap().push(format!("dropped:{bytes}"));
    }

    fn on_disconnected(&self) {
        self.log.lock().unwrap().push("disconnected".into());
    }

    fn on_turn_ended(&self, session_id: &str) {
        self.log
            .lock()
            .unwrap()
            .push(format!("turn_ended:{session_id}"));
    }
}

/// The agent's end of the pipes.
struct FakeAgent {
    reader: BufReader<DuplexStream>,
    writer: DuplexStream,
}

impl FakeAgent {
    async fn next(&mut self) -> Value {
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(5), self.reader.read_line(&mut line))
            .await
            .expect("the client wrote nothing")
            .unwrap();
        serde_json::from_str(&line).expect("the client wrote invalid JSON")
    }

    async fn send(&mut self, value: Value) {
        let mut line = serde_json::to_vec(&value).unwrap();
        line.push(b'\n');
        self.writer.write_all(&line).await.unwrap();
        self.writer.flush().await.unwrap();
    }

    async fn send_raw(&mut self, text: &str) {
        self.writer.write_all(text.as_bytes()).await.unwrap();
        self.writer.flush().await.unwrap();
    }
}

fn connect(host: Arc<dyn ClientHost>) -> (Arc<AcpClient>, FakeAgent) {
    let (client_out, agent_in) = tokio::io::duplex(1 << 21);
    let (agent_out, client_in) = tokio::io::duplex(1 << 21);
    let client = AcpClient::from_streams(client_in, client_out, host);
    (
        client,
        FakeAgent {
            reader: BufReader::new(agent_in),
            writer: agent_out,
        },
    )
}

fn update(index: usize) -> Value {
    json!({"jsonrpc": "2.0", "method": "session/update", "params": {
        "sessionId": "s1",
        "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": index.to_string()}},
    }})
}

#[tokio::test]
async fn a_response_is_seen_after_the_updates_sent_before_it() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host.clone());
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .request("session/prompt", json!({}), Duration::from_secs(5))
                .await
        })
    };
    let request = agent.next().await;
    for index in 0..3 {
        agent.send(update(index)).await;
    }
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"stopReason": "end_turn"}}))
        .await;
    let value = waiting.await.unwrap().unwrap();
    assert_eq!(value["stopReason"], "end_turn");
    assert_eq!(host.log(), ["update", "update", "update"]);
}

#[tokio::test]
async fn agent_requests_with_string_ids_are_answered_with_the_same_id() {
    let host = Arc::new(RecordingHost::default());
    let (_client, mut agent) = connect(host.clone());
    agent
        .send(json!({"jsonrpc": "2.0", "id": "permission-wire", "method": "session/request_permission",
            "params": {"sessionId": "s1", "toolCall": {"toolCallId": "t1"}, "options": []}}))
        .await;
    let answer = agent.next().await;
    assert_eq!(answer["id"], "permission-wire");
    assert_eq!(answer["result"]["outcome"]["outcome"], "cancelled");
}

#[tokio::test]
async fn a_reply_too_large_for_a_frame_becomes_an_error_and_the_connection_stays_open() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host.clone());
    agent
        .send(
            json!({"jsonrpc": "2.0", "id": 7, "method": "fs/read_text_file",
            "params": {"sessionId": "s1", "path": "/p/big.txt"}}),
        )
        .await;
    let answer = agent.next().await;
    assert_eq!(answer["id"], 7);
    assert_eq!(answer["error"]["code"], -32603);
    assert_eq!(
        answer["error"]["message"],
        "The reply is too large to send over ACP."
    );
    // The connection still works in both directions.
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .request("session/new", json!({}), Duration::from_secs(5))
                .await
        })
    };
    let request = agent.next().await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"sessionId": "s1"}}))
        .await;
    assert_eq!(waiting.await.unwrap().unwrap()["sessionId"], "s1");
    assert!(!client.is_closed());
    assert!(!host.log().contains(&"disconnected".to_string()));
}

#[tokio::test(start_paused = true)]
async fn a_session_load_is_not_stopped_while_its_replay_keeps_arriving() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move { client.load_session("s1", "/p", &[]).await })
    };
    let request = agent.next().await;
    assert_eq!(request["method"], "session/load");
    // Longer than the 60 s of a plain request, with no 60 s of silence.
    for index in 0..6 {
        tokio::time::sleep(Duration::from_secs(50)).await;
        agent.send(update(index)).await;
    }
    assert!(!waiting.is_finished());
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {}}))
        .await;
    assert!(waiting.await.unwrap().is_ok());
    assert!(!client.is_closed());
}

#[tokio::test(start_paused = true)]
async fn a_session_load_that_goes_quiet_stops_the_agent() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move { client.load_session("s1", "/p", &[]).await })
    };
    agent.next().await;
    tokio::time::sleep(Duration::from_secs(50)).await;
    agent.send(update(0)).await;
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(
        error.message,
        "The agent did not reply in time and was stopped."
    );
}

#[tokio::test]
async fn the_thirty_third_pending_request_is_refused() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let mut waiting = Vec::new();
    for _ in 0..32 {
        let client = client.clone();
        waiting.push(tokio::spawn(async move {
            client
                .request("slow", json!({}), Duration::from_secs(30))
                .await
        }));
    }
    for _ in 0..32 {
        agent.next().await;
    }
    let error = client
        .request("one-more", json!({}), Duration::from_secs(1))
        .await
        .unwrap_err();
    assert_eq!(error.message, "Too many ACP requests are pending.");
    for task in waiting {
        task.abort();
    }
}

#[tokio::test(start_paused = true)]
async fn a_request_past_its_deadline_stops_the_agent() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .request("session/new", json!({}), Duration::from_secs(60))
                .await
        })
    };
    agent.next().await;
    agent
        .send_raw("Error: connect ETIMEDOUT 104.18.0.1:443\n")
        .await;
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(
        error.message,
        "The agent did not reply in time and was stopped. Last output from the agent: Error: connect ETIMEDOUT 104.18.0.1:443"
    );
    assert_eq!(error.kind, Some(ErrorKind::TimedOutStopped));
    assert_eq!(
        error.output.as_deref(),
        Some("Error: connect ETIMEDOUT 104.18.0.1:443")
    );
    tokio::time::timeout(Duration::from_secs(10), async {
        while !client.is_closed() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the client closes after a missed deadline");
}

#[tokio::test]
async fn a_request_larger_than_the_frame_is_refused_before_sending() {
    let host = Arc::new(RecordingHost::default());
    let (client, _agent) = connect(host);
    let error = client
        .request(
            "session/prompt",
            json!({"text": "x".repeat(oleafly_acp::limits::MAX_FRAME)}),
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.message,
        "This ACP request exceeds the 1 MiB message limit."
    );
}

#[tokio::test]
async fn log_lines_on_the_agents_stdout_do_not_end_the_session() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host.clone());
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move { client.new_session("/project", &[]).await })
    };
    let request = agent.next().await;
    agent
        .send_raw("[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)\n")
        .await;
    agent
        .send_raw("{\"level\":30,\"msg\":\"connected to oleafly-research\"}\n")
        .await;
    agent
        .send_raw("Warning: \u{4e0d}\u{652f}\u{6301}\r\n")
        .await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"sessionId": "s1"}}))
        .await;
    let session = waiting.await.unwrap().unwrap();
    assert_eq!(session["sessionId"], "s1");
    assert!(!client.is_closed());
    assert!(!host.log().contains(&"disconnected".to_string()));
    let tail = client.stderr_tail();
    assert!(
        tail.contains("model listing from https://api.deepseek.com/models"),
        "{tail}"
    );
    assert!(tail.contains("connected to oleafly-research"), "{tail}");
}

#[tokio::test]
async fn a_disconnect_after_stdout_noise_quotes_it() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move { client.new_session("/project", &[]).await })
    };
    agent.next().await;
    agent.send_raw("Error: DEEPSEEK_API_KEY is not set\n").await;
    drop(agent);
    let error = waiting.await.unwrap().unwrap_err();
    assert!(
        error.message.contains("DEEPSEEK_API_KEY is not set"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn an_internal_error_keeps_the_agents_details_and_asks_for_setup() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move { client.new_session("/project", &[]).await })
    };
    let request = agent.next().await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "error": {
            "code": -32603,
            "message": "Internal error",
            "data": {"details": "No LLM provider configured. Run `hermes model` to select a provider, or `hermes setup` for first-time setup."},
        }}))
        .await;
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(
        error.message,
        "No LLM provider configured. Run `hermes model` to select a provider, or `hermes setup` for first-time setup."
    );
    assert!(error.auth_required());
}

#[tokio::test]
async fn an_error_with_its_own_message_adds_a_plain_text_detail() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move { client.new_session("/project", &[]).await })
    };
    let request = agent.next().await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "error": {
            "code": -32602,
            "message": "Invalid params",
            "data": "cwd must be an absolute path",
        }}))
        .await;
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(
        error.message,
        "Invalid params: cwd must be an absolute path"
    );
    assert!(!error.auth_required());
}

#[tokio::test]
async fn an_agent_that_closes_its_output_disconnects_once() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host.clone());
    agent.send_raw("not json\n").await;
    drop(agent);
    tokio::time::timeout(Duration::from_secs(5), async {
        while !host.log().contains(&"disconnected".to_string()) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the host hears about the disconnect");
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        host.log()
            .iter()
            .filter(|entry| *entry == "disconnected")
            .count(),
        1
    );
    assert!(client.is_closed());
}

#[tokio::test]
async fn a_closed_agent_fails_pending_requests_with_the_disconnect_message() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .request("session/new", json!({}), Duration::from_secs(5))
                .await
        })
    };
    agent.next().await;
    drop(agent);
    let error = waiting.await.unwrap().unwrap_err();
    assert!(
        error.message.starts_with("The agent disconnected"),
        "{}",
        error.message
    );
    assert!(matches!(
        error.kind,
        Some(ErrorKind::Disconnected | ErrorKind::DisconnectedBeforeReply)
    ));
}

#[tokio::test]
async fn ten_thousand_updates_arrive_in_order() {
    let host = Arc::new(RecordingHost::default());
    let (_client, mut agent) = connect(host.clone());
    for index in 0..10_000 {
        agent.send(update(index)).await;
    }
    tokio::time::timeout(Duration::from_secs(30), async {
        while host.updates.lock().unwrap().len() < 10_000 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("every update arrives");
    let updates = host.updates.lock().unwrap();
    for (index, params) in updates.iter().enumerate() {
        assert_eq!(params["update"]["content"]["text"], index.to_string());
    }
}

#[tokio::test]
async fn an_agent_cancel_request_marks_the_incoming_request_cancelled() {
    let host = Arc::new(RecordingHost::default());
    let (signal, mut cancelled) = mpsc::unbounded_channel();
    *host.cancelled.lock().unwrap() = Some(signal);
    let (_client, mut agent) = connect(host);
    agent
        .send(json!({"jsonrpc": "2.0", "id": 7, "method": "slow/request", "params": {}}))
        .await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    agent
        .send(json!({"jsonrpc": "2.0", "method": "$/cancel_request", "params": {"requestId": 7}}))
        .await;
    tokio::time::timeout(Duration::from_secs(1), cancelled.recv())
        .await
        .expect("the request sees the agent's cancellation")
        .unwrap();
}

#[tokio::test]
async fn null_host_cancels_permissions_and_rejects_other_requests() {
    let (_client, mut agent) = connect(Arc::new(NullHost));
    agent
        .send(json!({"jsonrpc": "2.0", "id": 1, "method": "fs/write_text_file", "params": {}}))
        .await;
    let answer = agent.next().await;
    assert_eq!(answer["error"]["code"], -32601);
    agent
        .send(json!({"jsonrpc": "2.0", "id": 2, "method": "session/request_permission", "params": {}}))
        .await;
    let answer = agent.next().await;
    assert_eq!(answer["result"]["outcome"]["outcome"], "cancelled");
}

#[tokio::test]
async fn a_cut_tool_update_reaches_the_host_before_its_dropped_notice() {
    let host = Arc::new(RecordingHost::default());
    let (_client, mut agent) = connect(host.clone());
    agent
        .send(json!({"jsonrpc": "2.0", "method": "session/update", "params": {
            "sessionId": "s1",
            "update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
                "content": [{"type": "content", "content": {"type": "text", "text": "x".repeat(3 << 20)}}]},
        }}))
        .await;
    tokio::time::timeout(Duration::from_secs(10), async {
        while host.log().len() < 2 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let log = host.log();
    assert_eq!(log[0], "update");
    assert!(log[1].starts_with("dropped:"));
    let updates = host.updates.lock().unwrap();
    assert_eq!(updates[0]["update"]["truncated"], true);
}

#[tokio::test]
async fn a_prompt_reply_ends_the_turn_in_order_with_the_updates() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host.clone());
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .prompt(
                    "s1",
                    vec![json!({"type": "text", "text": "hi"})],
                    TurnTiming::default(),
                )
                .await
        })
    };
    let request = agent.next().await;
    agent.send(update(0)).await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"stopReason": "end_turn"}}))
        .await;
    agent.send(update(1)).await;
    assert_eq!(waiting.await.unwrap().unwrap()["stopReason"], "end_turn");
    for _ in 0..200 {
        if host.log().len() == 3 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    // The update after the reply comes after the turn's end, however the
    // tasks that read them are scheduled.
    assert_eq!(host.log(), ["update", "turn_ended:s1", "update"]);
}

#[tokio::test]
async fn a_plain_request_ends_no_turn() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host.clone());
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .request("session/load", json!({}), Duration::from_secs(5))
                .await
        })
    };
    let request = agent.next().await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {}}))
        .await;
    waiting.await.unwrap().unwrap();
    assert!(host.log().is_empty(), "{:?}", host.log());
}

#[tokio::test(start_paused = true)]
async fn inactivity_stops_a_silent_turn() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .prompt(
                    "s1",
                    vec![json!({"type": "text", "text": "hi"})],
                    TurnTiming {
                        inactivity: Some(Duration::from_secs(20 * 60)),
                        ..Default::default()
                    },
                )
                .await
        })
    };
    agent.next().await;
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(
        error.message,
        "The agent sent nothing for 20 minutes, so Oleafly stopped it. Reconnect to continue."
    );
    assert_eq!(error.kind, Some(ErrorKind::Silent { minutes: 20 }));
}

#[tokio::test(start_paused = true)]
async fn each_frame_resets_the_inactivity_clock() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .prompt(
                    "s1",
                    Vec::new(),
                    TurnTiming {
                        inactivity: Some(Duration::from_secs(20 * 60)),
                        ..Default::default()
                    },
                )
                .await
        })
    };
    let request = agent.next().await;
    for index in 0..6 {
        tokio::time::sleep(Duration::from_secs(19 * 60)).await;
        agent.send(update(index)).await;
    }
    assert!(!waiting.is_finished());
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"stopReason": "end_turn"}}))
        .await;
    assert_eq!(waiting.await.unwrap().unwrap()["stopReason"], "end_turn");
}

#[tokio::test(start_paused = true)]
async fn hold_pauses_the_inactivity_clock() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let (hold_tx, hold_rx) = tokio::sync::watch::channel(true);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .prompt(
                    "s1",
                    Vec::new(),
                    TurnTiming {
                        inactivity: Some(Duration::from_secs(60)),
                        hold: Some(hold_rx),
                        ..Default::default()
                    },
                )
                .await
        })
    };
    agent.next().await;
    tokio::time::sleep(Duration::from_secs(600)).await;
    assert!(!waiting.is_finished(), "an open card keeps the turn alive");
    hold_tx.send_replace(false);
    let error = waiting.await.unwrap().unwrap_err();
    assert!(error.message.contains("sent nothing"));
}

#[tokio::test(start_paused = true)]
async fn the_absolute_cap_ends_a_busy_turn() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .prompt(
                    "s1",
                    Vec::new(),
                    TurnTiming {
                        inactivity: Some(Duration::from_secs(60)),
                        absolute: Some(Duration::from_secs(300)),
                        hold: None,
                    },
                )
                .await
        })
    };
    agent.next().await;
    for index in 0..10 {
        tokio::time::sleep(Duration::from_secs(30)).await;
        agent.send(update(index)).await;
    }
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(
        error.message,
        "The agent did not reply in time and was stopped."
    );
}

#[tokio::test]
async fn steering_asks_for_prompt_required_idle_behavior() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .steer(
                    "s1",
                    vec![json!({"type": "text", "text": "also check fig 2"})],
                )
                .await
        })
    };
    let request = agent.next().await;
    assert_eq!(request["method"], "_session/steering");
    assert_eq!(
        request["params"]["_meta"]["steering"]["idleBehavior"],
        "promptRequired"
    );
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"outcome": "injected"}}))
        .await;
    assert_eq!(waiting.await.unwrap().unwrap()["outcome"], "injected");
}

/// Records updates slowly, so the agent's last messages are still queued
/// when its output ends.
#[derive(Default)]
struct SlowHost {
    inner: RecordingHost,
}

impl ClientHost for SlowHost {
    fn on_update(&self, params: Value) {
        std::thread::sleep(Duration::from_millis(2));
        self.inner.on_update(params);
    }

    fn on_request(&self, request: IncomingRequest) {
        self.inner.on_request(request);
    }

    fn on_notification(&self, method: &str, params: Value) {
        self.inner.on_notification(method, params);
    }

    fn on_dropped_update(&self, bytes: usize) {
        self.inner.on_dropped_update(bytes);
    }

    fn on_disconnected(&self) {
        self.inner.on_disconnected();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reply_sent_just_before_the_agent_exits_still_reaches_its_caller() {
    let host = Arc::new(SlowHost::default());
    let (client, mut agent) = connect(host.clone());
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .request("logout", json!({}), Duration::from_secs(30))
                .await
        })
    };
    let request = agent.next().await;
    for index in 0..100 {
        agent.send(update(index)).await;
    }
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"done": true}}))
        .await;
    drop(agent);
    assert_eq!(waiting.await.unwrap().unwrap()["done"], true);
    tokio::time::timeout(Duration::from_secs(5), async {
        while !host.inner.log().contains(&"disconnected".to_string()) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the host hears about the disconnect");
    let log = host.inner.log();
    // Every update the agent sent was handled before the disconnect.
    assert_eq!(log.iter().filter(|entry| *entry == "update").count(), 100);
    assert_eq!(log.last().map(String::as_str), Some("disconnected"));
}

#[tokio::test(start_paused = true)]
async fn a_v2_turn_ends_when_the_agent_disconnects() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let initializing = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .initialize(&oleafly_acp::ClientOptions {
                    info: oleafly_acp::ClientInfo {
                        name: "test".into(),
                        title: "Test".into(),
                        version: "1".into(),
                    },
                    prefer_v2: true,
                    fs_read: false,
                })
                .await
        })
    };
    let request = agent.next().await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": request["id"], "result": {
            "protocolVersion": 2, "capabilities": {"session": {}}, "authMethods": []}}))
        .await;
    initializing.await.unwrap().unwrap();
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .prompt(
                    "s1",
                    vec![json!({"type": "text", "text": "hi"})],
                    TurnTiming {
                        inactivity: Some(Duration::from_secs(20 * 60)),
                        ..Default::default()
                    },
                )
                .await
        })
    };
    let prompt = agent.next().await;
    agent
        .send(json!({"jsonrpc": "2.0", "id": prompt["id"], "result": {"messageId": "accepted-1"}}))
        .await;
    drop(agent);
    let error = waiting.await.unwrap().unwrap_err();
    assert!(
        error.message.starts_with("The agent disconnected"),
        "{}",
        error.message
    );
}

#[tokio::test(start_paused = true)]
async fn a_turn_that_only_cancels_keeps_the_agent_running_past_its_limit() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host);
    let waiting = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .prompt_or_cancel(
                    "s1",
                    vec![json!({"type": "text", "text": "/status"})],
                    TurnTiming {
                        inactivity: Some(Duration::from_secs(60)),
                        absolute: Some(Duration::from_secs(90)),
                        hold: None,
                    },
                )
                .await
        })
    };
    agent.next().await;
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(error.message, "The agent did not reply in time.");
    assert_eq!(error.kind, Some(ErrorKind::TimedOut));
    let cancel = agent.next().await;
    assert_eq!(cancel["method"], "session/cancel");
    assert_eq!(cancel["params"]["sessionId"], "s1");
    assert!(!client.is_closed());
}
