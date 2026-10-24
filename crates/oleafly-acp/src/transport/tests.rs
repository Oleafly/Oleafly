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
    let lines: Vec<String> = incoming_lines(std::io::Cursor::new(line))
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

#[tokio::test]
async fn an_agent_cannot_send_the_reserved_method() {
    let input = concat!(
        "{\"jsonrpc\":\"2.0\",\"method\":\"_oleafly/dropped_update\",\"params\":{\"bytes\":1}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}\n",
    );
    let lines: Vec<String> = incoming_lines(std::io::Cursor::new(input.as_bytes().to_vec()))
        .map(Result::unwrap)
        .collect()
        .await;
    assert_eq!(
        lines,
        vec!["{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}".to_string()]
    );
}

#[tokio::test]
async fn invalid_json_ends_the_line_stream_with_an_error() {
    let input = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\nnot json\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n".to_vec();
    let items: Vec<io::Result<String>> =
        incoming_lines(std::io::Cursor::new(input)).collect().await;
    assert_eq!(items.len(), 2);
    assert!(items[0].is_ok());
    let error = items[1].as_ref().unwrap_err();
    assert_eq!(error.to_string(), "The agent sent invalid ACP JSON.");
}

#[tokio::test]
async fn a_batch_array_is_not_a_message() {
    let input = b"[{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}]\n".to_vec();
    let items: Vec<io::Result<String>> =
        incoming_lines(std::io::Cursor::new(input)).collect().await;
    assert!(items[0].is_err());
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
    // A pipe nobody reads: its buffer fills and the write never completes.
    let (writer, _reader) = tokio::io::duplex(16);
    let mut sink = Box::pin(outgoing_lines(writer));
    let error = sink.send("x".repeat(1024)).await.unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
}
