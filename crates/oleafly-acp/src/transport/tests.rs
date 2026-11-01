use futures::{SinkExt, StreamExt};
use tokio::io::BufReader;

use super::*;

fn tool_update(bytes: usize) -> Vec<u8> {
    let padding = "x".repeat(bytes);
    let mut line = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "t1",
                "status": "completed",
                "content": [{"type": "content", "content": {"type": "text", "text": padding}}],
            },
        },
    }))
    .unwrap();
    line.push(b'\n');
    line
}

#[tokio::test]
async fn read_frame_accepts_an_envelope_and_rejects_garbage() {
    let value = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n";
    assert!(read_frame(&mut BufReader::new(&value[..]))
        .await
        .unwrap()
        .is_some());
    let windows = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\r\n";
    assert!(read_frame(&mut BufReader::new(&windows[..]))
        .await
        .unwrap()
        .is_some());
    assert!(read_frame(&mut BufReader::new(&b"not json\n"[..]))
        .await
        .is_err());
    assert!(
        read_frame(&mut BufReader::new(&b"{\"jsonrpc\":\"2.0\"}"[..]))
            .await
            .is_err()
    );
    let oversized = vec![b'x'; MAX_FRAME + 1];
    assert!(read_frame(&mut BufReader::new(&oversized[..]))
        .await
        .is_err());
}

#[tokio::test]
async fn an_oversized_tool_update_keeps_its_identity() {
    let line = tool_update(2 * 1024 * 1024);
    let Some(Frame::TruncatedUpdate { bytes, message }) =
        read_agent_frame(&mut BufReader::new(&line[..]))
            .await
            .unwrap()
    else {
        panic!("a 2 MiB tool update must be cut, not dropped");
    };
    assert_eq!(bytes, line.len());
    assert_eq!(message["params"]["update"]["toolCallId"], "t1");
    assert_eq!(message["params"]["update"]["truncated"], true);
    assert!(message["params"]["update"].get("content").is_none());
}

#[tokio::test]
async fn an_oversized_response_ends_the_connection() {
    let mut line = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"text": "x".repeat(2 * 1024 * 1024)},
    }))
    .unwrap();
    line.push(b'\n');
    let error = read_agent_frame(&mut BufReader::new(&line[..]))
        .await
        .unwrap_err();
    assert!(
        error.message.contains("larger than 1 MiB."),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn a_frame_over_16_mib_fails_without_reading_further() {
    let line = tool_update(17 * 1024 * 1024);
    let error = read_agent_frame(&mut BufReader::new(&line[..]))
        .await
        .unwrap_err();
    assert!(error.message.contains("16 MiB"), "{}", error.message);
}

#[tokio::test]
async fn the_line_stream_yields_the_cut_update_then_a_dropped_notice() {
    let line = tool_update(2 * 1024 * 1024);
    let size = line.len();
    let lines: Vec<String> = incoming_lines(std::io::Cursor::new(line), |_: &[u8]| {})
        .map(Result::unwrap)
        .collect()
        .await;
    assert_eq!(lines.len(), 2);
    let cut: Value = serde_json::from_str(&lines[0]).unwrap();
    assert_eq!(cut["params"]["update"]["truncated"], true);
    let notice: Value = serde_json::from_str(&lines[1]).unwrap();
    assert_eq!(notice["method"], DROPPED_UPDATE_METHOD);
    assert_eq!(notice["params"]["bytes"], size);
}

fn permission_request(bytes: usize) -> Vec<u8> {
    let text = "x".repeat(bytes / 2);
    let mut line = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": 41,
        "method": "session/request_permission",
        "params": {
            "sessionId": "s1",
            "toolCall": {
                "toolCallId": "write-1",
                "title": "Write refs.bib",
                "kind": "edit",
                "status": "pending",
                "locations": [{"path": "/project/refs.bib"}],
                "rawInput": {"file_path": "/project/refs.bib", "content": text},
                "content": [{"type": "diff", "path": "/project/refs.bib", "oldText": null, "newText": text}],
            },
            "options": [
                {"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                {"optionId": "reject", "name": "Reject", "kind": "reject_once"},
            ],
        },
    }))
    .unwrap();
    line.push(b'\n');
    line
}

#[tokio::test]
async fn an_oversized_permission_request_keeps_its_question_and_paths() {
    let mut input = permission_request(1_200_000);
    let size = input.len();
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}\n");
    let lines: Vec<String> = incoming_lines(std::io::Cursor::new(input), |_: &[u8]| {})
        .map(Result::unwrap)
        .collect()
        .await;
    assert_eq!(lines.len(), 3);
    let cut: Value = serde_json::from_str(&lines[0]).unwrap();
    assert!(lines[0].len() < 4096);
    assert_eq!(cut["id"], 41);
    assert_eq!(cut["method"], "session/request_permission");
    assert_eq!(cut["params"]["sessionId"], "s1");
    assert_eq!(cut["params"]["options"][1]["optionId"], "reject");
    let call = &cut["params"]["toolCall"];
    assert_eq!(call["toolCallId"], "write-1");
    assert_eq!(call["kind"], "edit");
    assert_eq!(call["locations"], json!([{"path": "/project/refs.bib"}]));
    assert_eq!(
        call["content"],
        json!([{"type": "diff", "path": "/project/refs.bib", "oldText": null, "newText": null}])
    );
    assert!(call.get("rawInput").is_none());
    let notice: Value = serde_json::from_str(&lines[1]).unwrap();
    assert_eq!(notice["params"]["bytes"], size);
    assert_eq!(lines[2], "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}");
}

#[tokio::test]
async fn an_agent_cannot_send_the_reserved_method() {
    let input = concat!(
        "{\"jsonrpc\":\"2.0\",\"method\":\"_oleafly/dropped_update\",\"params\":{\"bytes\":1}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}\n",
    );
    let lines: Vec<String> = incoming_lines(
        std::io::Cursor::new(input.as_bytes().to_vec()),
        |_: &[u8]| {},
    )
    .map(Result::unwrap)
    .collect()
    .await;
    assert_eq!(
        lines,
        vec!["{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}".to_string()]
    );
}

fn collect_with_strays(input: Vec<u8>) -> (Vec<io::Result<String>>, Vec<String>) {
    let strays = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = strays.clone();
    let items = futures::executor::block_on(
        incoming_lines(std::io::Cursor::new(input), move |line: &[u8]| {
            seen.lock()
                .unwrap()
                .push(String::from_utf8_lossy(line).into_owned());
        })
        .collect(),
    );
    let strays = strays.lock().unwrap().clone();
    (items, strays)
}

#[test]
fn lines_that_are_not_json_rpc_are_handed_aside_and_reading_goes_on() {
    let input = concat!(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n",
        "[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)\n",
        "{\"level\":30,\"msg\":\"ready\"}\n",
        "{\"jsonrpc\":\"1.0\",\"id\":7}\n",
        "not json\r\n",
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n",
    );
    let (items, strays) = collect_with_strays(input.as_bytes().to_vec());
    let lines: Vec<String> = items.into_iter().map(Result::unwrap).collect();
    assert_eq!(
        lines,
        vec![
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}".to_string(),
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}".to_string(),
        ]
    );
    assert_eq!(strays.len(), 4);
    assert!(strays[0].starts_with("[llm-deepseek-account] model listing"));
    assert_eq!(strays[3], "not json\r\n");
}

#[test]
fn a_batch_array_is_handed_aside_not_delivered() {
    let (items, strays) =
        collect_with_strays(b"[{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}]\n".to_vec());
    assert!(items.is_empty());
    assert_eq!(strays.len(), 1);
}

#[test]
fn an_oversized_line_of_plain_text_is_handed_aside() {
    let mut line = vec![b'x'; 2 * 1024 * 1024];
    line.push(b'\n');
    let (items, strays) = collect_with_strays(line);
    assert!(items.is_empty());
    assert_eq!(strays.len(), 1);
}

#[test]
fn an_oversized_reply_still_ends_the_stream() {
    let mut line = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"text": "x".repeat(2 * 1024 * 1024)},
    }))
    .unwrap();
    line.push(b'\n');
    let (items, strays) = collect_with_strays(line);
    assert_eq!(items.len(), 1);
    assert!(items[0]
        .as_ref()
        .unwrap_err()
        .to_string()
        .contains("larger than 1 MiB"));
    assert!(strays.is_empty());
}

#[tokio::test]
async fn the_sink_refuses_a_line_at_the_frame_limit() {
    let (writer, _reader) = tokio::io::duplex(4 * MAX_FRAME);
    let mut sink = Box::pin(outgoing_lines(writer));
    let line = "x".repeat(MAX_FRAME - 1);
    assert!(sink.send(line).await.is_err());
}

#[tokio::test(start_paused = true)]
async fn the_sink_times_out_a_stuck_writer() {
    let (writer, _reader) = tokio::io::duplex(16);
    let mut sink = Box::pin(outgoing_lines(writer));
    let error = sink.send("x".repeat(1024)).await.unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
}
