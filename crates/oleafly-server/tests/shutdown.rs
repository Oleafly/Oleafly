mod people;

use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::ClientFrame;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::poll::{
    PollBatch, DEVICE_HEADER, NONCE_HEADER, POLL_KEY_HEADER, PROTOCOL_HEADER, SIGNATURE_HEADER,
};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_server::test_support::{challenge_nonce, socket_request};
use people::{grant, share_project, stage, Person, Stage};
use reqwest::StatusCode;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::Message;

const PROMPTLY: Duration = Duration::from_secs(5);

async fn open_poll(stage: &Stage, person: &Person, project: SharedProjectId) -> (String, String) {
    let nonce = challenge_nonce(&stage.server).await;
    let signature = person.device.sign_b64(&challenge_message(
        ChallengePurpose::Socket,
        stage.server.state().server_id,
        &nonce,
    ));
    let batch: PollBatch = reqwest::Client::new()
        .get(format!(
            "{}/api/v1/projects/{project}/poll",
            stage.server.url()
        ))
        .query(&[("since", "0")])
        .bearer_auth(person.token())
        .header(DEVICE_HEADER, person.tokens.device_id.to_string())
        .header(NONCE_HEADER, nonce)
        .header(SIGNATURE_HEADER, signature)
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
        .send()
        .await
        .expect("open request")
        .json()
        .await
        .expect("poll batch");
    assert!(
        matches!(batch.frames.first(), Some(ServerFrame::Subscribed { .. })),
        "{:?}",
        batch.frames
    );
    (
        batch.key.expect("a session key"),
        batch.cursor.expect("a cursor"),
    )
}

#[tokio::test]
async fn stopping_the_server_answers_a_waiting_long_poll_at_once() {
    let stage = stage().await;
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    assert_eq!(
        grant(
            &stage.server,
            &stage.bob,
            project,
            &stage.alice,
            ProjectRole::Editor
        )
        .await
        .status(),
        StatusCode::OK
    );
    let (key, cursor) = open_poll(&stage, &stage.alice, project).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let serving = tokio::spawn(oleafly_server::serve_on(
        stage.server.state().clone(),
        listener,
        async move {
            let _ = stopped.await;
        },
    ));
    let waiting = tokio::spawn(async move {
        reqwest::Client::new()
            .get(format!("http://{address}/api/v1/projects/{project}/poll"))
            .query(&[("cursor", cursor.as_str())])
            .header(POLL_KEY_HEADER, key)
            .send()
            .await
            .map(|response| response.status())
    });
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        !waiting.is_finished(),
        "the poll should be waiting for news"
    );
    let started = Instant::now();
    stop.send(()).unwrap();
    let answered = tokio::time::timeout(PROMPTLY, waiting)
        .await
        .expect("the waiting poll is answered once the server stops")
        .unwrap();
    assert_eq!(answered.ok(), Some(StatusCode::OK));
    tokio::time::timeout(PROMPTLY, serving)
        .await
        .expect("the server stops without waiting out the poll")
        .unwrap()
        .expect("the server stops cleanly");
    assert!(started.elapsed() < PROMPTLY, "{:?}", started.elapsed());
}

#[tokio::test]
async fn stopping_the_server_tells_open_sockets_it_is_restarting() {
    let stage = stage().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let serving = tokio::spawn(oleafly_server::serve_on(
        stage.server.state().clone(),
        listener,
        async move {
            let _ = stopped.await;
        },
    ));
    let person = &stage.alice;
    let (mut socket, _) = tokio_tungstenite::connect_async(socket_request(
        &format!("http://{address}"),
        Some(person.token()),
    ))
    .await
    .expect("connect");
    let challenge = match socket.next().await {
        Some(Ok(Message::Text(text))) => {
            serde_json::from_str::<ServerFrame>(text.as_str()).expect("a challenge")
        }
        other => panic!("expected a challenge, got {other:?}"),
    };
    let ServerFrame::Challenge { nonce, server_id } = challenge else {
        panic!("expected a challenge, got {challenge:?}");
    };
    let hello = ClientFrame::Hello {
        protocol: PROTOCOL_VERSION,
        device_id: person.tokens.device_id,
        access_token: person.tokens.access_token.clone(),
        nonce: nonce.clone(),
        signature: person.device.sign_b64(&challenge_message(
            ChallengePurpose::Socket,
            server_id,
            &nonce,
        )),
        understands: Vec::new(),
    };
    socket
        .send(Message::text(serde_json::to_string(&hello).unwrap()))
        .await
        .expect("send the hello");
    assert!(matches!(
        socket.next().await,
        Some(Ok(Message::Text(text))) if text.as_str().contains("welcome")
    ));
    stop.send(()).unwrap();
    let closed = tokio::time::timeout(PROMPTLY, async {
        while let Some(message) = socket.next().await {
            if let Ok(Message::Close(frame)) = message {
                return frame.map(|frame| frame.code);
            }
        }
        None
    })
    .await
    .expect("the socket heard from the server before it stopped");
    assert_eq!(closed, Some(CloseCode::Restart));
    tokio::time::timeout(PROMPTLY, serving)
        .await
        .expect("the server stops")
        .unwrap()
        .expect("the server stops cleanly");
}
