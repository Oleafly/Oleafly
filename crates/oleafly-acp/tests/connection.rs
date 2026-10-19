//! The client against a scripted agent on in-memory pipes.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_acp::{AcpClient, ClientHost, IncomingRequest, NullHost, TurnTiming};
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
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(
        error.message,
        "The agent did not reply in time and was stopped."
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
async fn invalid_json_from_the_agent_disconnects_once() {
    let host = Arc::new(RecordingHost::default());
    let (client, mut agent) = connect(host.clone());
    agent.send_raw("not json\n").await;
    agent.send_raw("still not json\n").await;
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
