mod people;

use futures_util::SinkExt;
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::poll::{
    PollBatch, PollReplies, DEVICE_HEADER, NONCE_HEADER, POLL_KEY_HEADER, PROTOCOL_HEADER,
    SIGNATURE_HEADER,
};
use oleafly_server::test_support::challenge_nonce;
use people::{connect, next_frame, share_project, stage, subscribe};
use reqwest::StatusCode;
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;

const LATER_FRAME: &str = r#"{"type":"from_a_later_client","project_id":"later","detail":{"n":1}}"#;

fn unexpected(frame: &ServerFrame) -> bool {
    matches!(
        frame,
        ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            message,
        } if message == "Unexpected frame."
    )
}

#[tokio::test]
async fn a_socket_frame_of_an_unknown_type_is_answered_as_unexpected_and_the_connection_stays() {
    let stage = stage().await;
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    let mut socket = connect(&stage.server, &stage.bob).await;
    assert!(matches!(
        subscribe(&mut socket, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    for text in [
        r#"{"type":"ping","id":1}"#.to_owned(),
        LATER_FRAME.to_owned(),
        r#"{"type":"ping","id":2}"#.to_owned(),
    ] {
        socket.send(Message::text(text)).await.expect("send");
    }
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Pong { id: 1 })
    );
    let answer = next_frame(&mut socket).await.expect("an answer");
    assert!(unexpected(&answer), "{answer:?}");
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Pong { id: 2 })
    );
}

#[tokio::test]
async fn a_long_poll_frame_of_an_unknown_type_is_answered_as_unexpected_and_the_rest_are_handled() {
    let stage = stage().await;
    let server = &stage.server;
    let bob = &stage.bob;
    let project = share_project(server, bob, "Thesis").await.project_id;
    let nonce = challenge_nonce(server).await;
    let signature = bob.device.sign_b64(&challenge_message(
        ChallengePurpose::Socket,
        server.state().server_id,
        &nonce,
    ));
    let opened: PollBatch = reqwest::Client::new()
        .get(format!("{}/api/v1/projects/{project}/poll", server.url()))
        .query(&[("since", "0")])
        .bearer_auth(bob.token())
        .header(DEVICE_HEADER, bob.tokens.device_id.to_string())
        .header(NONCE_HEADER, nonce)
        .header(SIGNATURE_HEADER, signature)
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
        .send()
        .await
        .expect("open request")
        .json()
        .await
        .expect("poll batch");
    let later: serde_json::Value = serde_json::from_str(LATER_FRAME).expect("json");
    let response = reqwest::Client::new()
        .post(format!("{}/api/v1/projects/{project}/frames", server.url()))
        .header(POLL_KEY_HEADER, opened.key.expect("an open session"))
        .json(&json!({
            "frames": [
                { "type": "ping", "id": 1 },
                later,
                { "type": "ping", "id": 2 }
            ]
        }))
        .send()
        .await
        .expect("frames request");
    assert_eq!(response.status(), StatusCode::OK);
    let replies: PollReplies = response.json().await.expect("replies");
    assert!(
        matches!(
            replies.frames.as_slice(),
            [ServerFrame::Pong { id: 1 }, answer, ServerFrame::Pong { id: 2 }] if unexpected(answer)
        ),
        "{:?}",
        replies.frames
    );
}
