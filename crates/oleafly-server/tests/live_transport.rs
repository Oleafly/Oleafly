mod people;

use std::time::Duration;

use futures_util::StreamExt;
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose, SessionTokens};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::rate_limit::DEVICE_RECONNECT_BURST;
use oleafly_server::rooms::MAX_QUEUED_BYTES;
use oleafly_server::sockets::{LinkTiming, SocketLimits, MAX_SOCKETS_PER_DEVICE};
use oleafly_server::test_support::{seed_person, PersonSeed, TestDevice, TestServer};
use people::{
    connect, envelope, grant, next_frame, send_frame, send_update, share_project, stage, subscribe,
    Socket, Stage,
};
use reqwest::StatusCode;
use tokio_tungstenite::connect_async;

const MEGABYTE: usize = 1 << 20;

async fn shared_with_alice(stage: &Stage) -> SharedProjectId {
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
    project
}

async fn eventually(check: impl Fn() -> bool, within: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        if check() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn acknowledged(socket: &mut Socket) {
    loop {
        match next_frame(socket).await {
            Some(ServerFrame::Ack { .. }) => return,
            Some(ServerFrame::PresenceLeft { .. }) => {}
            other => panic!("expected an acknowledgement, got {other:?}"),
        }
    }
}

async fn hello_from(
    server: &TestServer,
    device: &TestDevice,
    tokens: &SessionTokens,
) -> Result<(Socket, ServerFrame), String> {
    let (mut socket, _) = connect_async(server.socket_request(&tokens.access_token))
        .await
        .map_err(|error| error.to_string())?;
    let Some(ServerFrame::Challenge { nonce, server_id }) = next_frame(&mut socket).await else {
        return Err("no challenge arrived".to_owned());
    };
    let hello = ClientFrame::Hello {
        protocol: PROTOCOL_VERSION,
        device_id: tokens.device_id,
        access_token: tokens.access_token.clone(),
        nonce: nonce.clone(),
        signature: device.sign_b64(&challenge_message(
            ChallengePurpose::Socket,
            server_id,
            &nonce,
        )),
        understands: Vec::new(),
    };
    send_frame(&mut socket, &hello).await;
    let answer = next_frame(&mut socket)
        .await
        .ok_or_else(|| "the socket closed after the hello".to_owned())?;
    Ok((socket, answer))
}

fn quick_links(server: &TestServer, timing: LinkTiming) {
    server.state().sockets.set_timing(timing);
}

#[tokio::test]
async fn a_subscriber_that_stops_reading_is_dropped_while_the_writer_keeps_going() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let state = stage.server.state();
    let stuck = stage.alice.tokens.device_id;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut alice, project, 0).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let text = vec![b'x'; MEGABYTE];
    let mut most_queued = 0;
    for _ in 0..60 {
        if state.sockets.count(stuck) == 0 {
            break;
        }
        send_update(&mut bob, &envelope(&stage.bob, project, &text)).await;
        acknowledged(&mut bob).await;
        most_queued = most_queued.max(state.rooms.queued_bytes());
    }
    assert!(
        eventually(|| state.sockets.count(stuck) == 0, Duration::from_secs(5)).await,
        "the server still holds a connection that stopped reading"
    );
    assert!(
        most_queued <= MAX_QUEUED_BYTES,
        "{most_queued} bytes waited for one reader"
    );
    assert_eq!(state.rooms.queued_bytes(), 0);
    drop(alice);
}

#[tokio::test]
async fn a_subscriber_that_stops_reading_is_dropped_after_the_send_grace() {
    let stage = stage().await;
    quick_links(
        &stage.server,
        LinkTiming {
            send_grace: Duration::from_millis(300),
            min_send_rate: u64::MAX,
            ..LinkTiming::default()
        },
    );
    let project = shared_with_alice(&stage).await;
    let state = stage.server.state();
    let stuck = stage.alice.tokens.device_id;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut alice, project, 0).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let text = vec![b'y'; MEGABYTE];
    for _ in 0..16 {
        send_update(&mut bob, &envelope(&stage.bob, project, &text)).await;
        acknowledged(&mut bob).await;
    }
    assert!(
        eventually(|| state.sockets.count(stuck) == 0, Duration::from_secs(5)).await,
        "a send to a reader that stopped never timed out"
    );
    drop(alice);
}

#[tokio::test]
async fn a_connection_that_never_answers_pings_is_closed() {
    let stage = stage().await;
    quick_links(
        &stage.server,
        LinkTiming {
            ping_every: Duration::from_millis(100),
            idle_after: Duration::from_millis(500),
            ..LinkTiming::default()
        },
    );
    let state = stage.server.state();
    let silent = stage.alice.tokens.device_id;
    let alice = connect(&stage.server, &stage.alice).await;
    assert!(
        eventually(|| state.sockets.count(silent) == 0, Duration::from_secs(5)).await,
        "a connection that never answered was kept open"
    );
    drop(alice);
}

#[tokio::test]
async fn a_connection_that_keeps_reading_stays_open_past_the_idle_limit() {
    let stage = stage().await;
    quick_links(
        &stage.server,
        LinkTiming {
            ping_every: Duration::from_millis(100),
            idle_after: Duration::from_millis(500),
            ..LinkTiming::default()
        },
    );
    let device = stage.bob.tokens.device_id;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let until = tokio::time::Instant::now() + Duration::from_millis(1_500);
    let reader = tokio::spawn(async move {
        let mut pings = 0usize;
        while let Ok(Some(Ok(message))) = tokio::time::timeout_at(until, bob.next()).await {
            if message.is_ping() {
                pings += 1;
            }
        }
        (bob, pings)
    });
    tokio::time::sleep_until(until - Duration::from_millis(100)).await;
    assert_eq!(stage.server.state().sockets.count(device), 1);
    let (_bob, pings) = reader.await.expect("the reader ends");
    assert!(pings >= 3, "only {pings} pings arrived");
}

#[tokio::test]
async fn a_long_catch_up_is_not_taken_for_a_quiet_connection() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let text = vec![b'z'; MEGABYTE];
    for _ in 0..20 {
        send_update(&mut bob, &envelope(&stage.bob, project, &text)).await;
        acknowledged(&mut bob).await;
    }
    quick_links(
        &stage.server,
        LinkTiming {
            ping_every: Duration::from_millis(20),
            idle_after: Duration::from_millis(100),
            ..LinkTiming::default()
        },
    );
    let device = stage.alice.tokens.device_id;
    let mut alice = connect(&stage.server, &stage.alice).await;
    send_frame(
        &mut alice,
        &ClientFrame::Subscribe {
            project_id: project,
            since_seq: 0,
        },
    )
    .await;
    let reader = tokio::spawn(async move {
        let mut updates = 0usize;
        let until = tokio::time::Instant::now() + Duration::from_secs(20);
        while let Ok(Some(Ok(message))) = tokio::time::timeout_at(until, alice.next()).await {
            if message
                .to_text()
                .is_ok_and(|text| text.contains("\"update\""))
            {
                updates += 1;
                if updates == 20 {
                    break;
                }
            }
        }
        (alice, updates)
    });
    let (mut alice, updates) = reader.await.expect("the reader ends");
    assert_eq!(updates, 20);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(stage.server.state().sockets.count(device), 1);
    send_frame(&mut alice, &ClientFrame::Ping { id: 9 }).await;
    assert_eq!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Pong { id: 9 })
    );
}

#[tokio::test]
async fn a_device_keeps_at_most_its_socket_allowance_and_the_oldest_gives_way() {
    let stage = stage().await;
    let state = stage.server.state();
    state.sockets.set_limits(SocketLimits {
        per_account: MAX_SOCKETS_PER_DEVICE + 1,
        ..SocketLimits::default()
    });
    let device = stage.bob.tokens.device_id;
    let mut oldest = connect(&stage.server, &stage.bob).await;
    let mut newer = Vec::new();
    for _ in 0..MAX_SOCKETS_PER_DEVICE {
        newer.push(connect(&stage.server, &stage.bob).await);
    }
    assert!(
        eventually(
            || state.sockets.count(device) == MAX_SOCKETS_PER_DEVICE,
            Duration::from_secs(5)
        )
        .await,
        "the device holds {} sockets",
        state.sockets.count(device)
    );
    assert_eq!(next_frame(&mut oldest).await, None);
    send_frame(&mut newer[0], &ClientFrame::Ping { id: 1 }).await;
    assert_eq!(
        next_frame(&mut newer[0]).await,
        Some(ServerFrame::Pong { id: 1 })
    );
}

#[tokio::test]
async fn a_crowd_behind_one_address_reconnects_at_once_and_can_still_sign_in() {
    let server = TestServer::start(oleafly_server::test_support::test_config()).await;
    let mut people = Vec::new();
    for index in 0..120 {
        let device = TestDevice::generate();
        let tokens = seed_person(
            server.state(),
            PersonSeed {
                name: format!("Student {index}"),
                email: format!("student{index}@uni.edu"),
                role: ServerRole::Member,
                device_public_key: device.public_key_b64().to_owned(),
                device_name: "Lab PC".to_owned(),
            },
        )
        .await
        .expect("seed a person");
        people.push((device, tokens));
    }
    let mut open = Vec::new();
    for (index, (device, tokens)) in people.iter().enumerate() {
        let (socket, answer) = hello_from(&server, device, tokens)
            .await
            .unwrap_or_else(|error| panic!("person {index} could not reconnect: {error}"));
        assert!(
            matches!(answer, ServerFrame::Welcome { .. }),
            "person {index} got {answer:?}"
        );
        open.push(socket);
    }
    let challenge = reqwest::Client::new()
        .post(format!("{}/auth/challenge", server.url()))
        .send()
        .await
        .expect("challenge");
    assert_eq!(challenge.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_device_reconnecting_in_a_tight_loop_is_slowed_down() {
    let stage = stage().await;
    let burst = usize::try_from(DEVICE_RECONNECT_BURST).expect("burst");
    for attempt in 0..burst {
        let (socket, answer) = hello_from(&stage.server, &stage.bob.device, &stage.bob.tokens)
            .await
            .unwrap_or_else(|error| panic!("reconnect {attempt} was refused: {error}"));
        assert!(
            matches!(answer, ServerFrame::Welcome { .. }),
            "reconnect {attempt} got {answer:?}"
        );
        drop(socket);
    }
    let (_socket, answer) = hello_from(&stage.server, &stage.bob.device, &stage.bob.tokens)
        .await
        .expect("the server answers the extra reconnect");
    assert!(
        matches!(
            answer,
            ServerFrame::Error {
                code: FrameErrorCode::RateLimited,
                ..
            }
        ),
        "{answer:?}"
    );
    let (_alice, welcome) = hello_from(&stage.server, &stage.alice.device, &stage.alice.tokens)
        .await
        .expect("another device still connects");
    assert!(matches!(welcome, ServerFrame::Welcome { .. }));
}
