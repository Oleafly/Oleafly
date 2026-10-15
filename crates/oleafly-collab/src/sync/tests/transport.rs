use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn two_editors_behind_a_proxy_that_blocks_websockets_still_converge() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start_with(
        &mut bob,
        link_via(&pair, &pair.bob, project, &proxy),
        quick(),
    );
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    assert!(proxy.refused() >= 4, "{} upgrades refused", proxy.refused());
    assert_eq!(pair._server.state().polls.count(), 2);
    lock(&bob.live)
        .editor_change(&main, 0, insert(3, "d", 3))
        .unwrap();
    bob.handle.as_ref().unwrap().flush();
    assert_eq!(
        next_message(&mut bob).await,
        DocMessage::Ack { rev: 1, length: 4 }
    );
    assert_eq!(
        next_message(&mut alice).await,
        DocMessage::Remote {
            rev: 1,
            op: insert(3, "d", 3),
            length: 4
        }
    );
    lock(&alice.live)
        .editor_change(&main, 1, insert(0, "!", 4))
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    assert_eq!(
        next_message(&mut bob).await,
        DocMessage::Remote {
            rev: 2,
            op: insert(0, "!", 4),
            length: 5
        }
    );
    assert_eq!(text(&bob, &main), "!abcd");
    assert_eq!(text(&alice, &main), "!abcd");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_long_poll_editor_catches_up_after_time_away_like_a_socket_one() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start_with(
        &mut bob,
        link_via(&pair, &pair.bob, project, &proxy),
        quick(),
    );
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut alice, LiveStatus::Online).await;
    until_status(&mut bob, LiveStatus::Online).await;
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "!", 3))
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    assert!(matches!(
        next_message(&mut alice).await,
        DocMessage::Ack { .. }
    ));
    until_text(&bob, &main, "!abc").await;
    acknowledged(&alice).await;
    alice.handle.take().unwrap().stopped().await;
    assert!(matches!(
        next_message(&mut bob).await,
        DocMessage::Remote { .. }
    ));
    for (rev, letter) in ["d", "e", "f", "g"].into_iter().enumerate() {
        let length = 4 + rev;
        lock(&bob.live)
            .editor_change(&main, 1 + rev as u64, insert(length, letter, length))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        assert!(matches!(
            next_message(&mut bob).await,
            DocMessage::Ack { .. }
        ));
        acknowledged(&bob).await;
    }
    assert_eq!(lock(&bob.live).last_seq(), 5);
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    let LiveEvent::Merged(report) =
        until_event(&mut alice, |event| matches!(event, LiveEvent::Merged(_))).await
    else {
        unreachable!()
    };
    assert_eq!(report.files.get(&main), Some(&4));
    until_text(&alice, &main, "!abcdefg").await;
    assert_eq!(lock(&alice.live).last_seq(), 5);
    assert_eq!(pair._server.state().polls.count(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn presence_and_leaving_cross_between_socket_and_long_poll() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start_with(&mut bob, link(&pair, &pair.bob, project), quick());
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    let handle = alice.handle.as_ref().unwrap();
    handle.presence(PresenceState {
        file_id: Some(main.clone()),
        cursor: Some(1),
        anchor: None,
    });
    handle.leave_presence();
    let device = pair.alice.tokens.device_id;
    super::editing::left_without_a_later_cursor(&mut bob, device).await;
    let here = PresenceState {
        file_id: Some(main.clone()),
        cursor: Some(2),
        anchor: None,
    };
    bob.handle.as_ref().unwrap().presence(here.clone());
    let seen = until_event(&mut alice, |event| {
        matches!(event, LiveEvent::Presence { .. })
    })
    .await;
    assert_eq!(
        seen,
        LiveEvent::Presence {
            device_id: pair.bob.tokens.device_id,
            account_id: pair.bob.tokens.account_id,
            state: here
        }
    );
    alice.handle.take().unwrap().stopped().await;
    let gone = until_event(&mut bob, |event| {
        matches!(event, LiveEvent::PresenceLeft { .. })
    })
    .await;
    assert_eq!(gone, LiveEvent::PresenceLeft { device_id: device });
    assert_eq!(pair._server.state().polls.count(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_socket_editor_and_a_long_poll_editor_typing_together_converge() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start_with(&mut bob, link(&pair, &pair.bob, project), quick());
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    assert_eq!(pair._server.state().polls.count(), 1);
    for round in 0..15 {
        let at_bob = text(&bob, &main);
        lock(&bob.live)
            .local_text(&main, &format!("{at_bob}b{round}"))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        let at_alice = text(&alice, &main);
        lock(&alice.live)
            .local_text(&main, &format!("a{round}{at_alice}"))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
    tokio::time::timeout(WAIT, async {
        loop {
            let (left, right) = (text(&bob, &main), text(&alice, &main));
            if left == right && left.contains("b14") && left.contains("a14") {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("both sides converged");
    acknowledged(&bob).await;
    acknowledged(&alice).await;
    let merged = text(&bob, &main);
    for round in 0..15 {
        assert!(merged.contains(&format!("b{round}")), "{merged}");
        assert!(merged.contains(&format!("a{round}")), "{merged}");
    }
    assert_eq!(lock(&bob.live).last_seq(), lock(&alice.live).last_seq());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_fallback_moves_back_to_the_socket_once_websockets_get_through() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    let options = TransportOptions {
        fallback_after: 2,
        retry_socket_every: Duration::from_millis(300),
        ..TransportOptions::default()
    };
    start_with(&mut bob, link(&pair, &pair.bob, project), quick());
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        options,
    );
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    let state = pair._server.state().clone();
    assert_eq!(state.polls.count(), 1);
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert_eq!(state.polls.count(), 1);
    proxy.block_websockets(false);
    let device = pair.alice.tokens.device_id;
    until(|| state.polls.count() == 0 && state.sockets.count(device) == 1).await;
    until_status(&mut alice, LiveStatus::Online).await;
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "?", 3))
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    until_text(&bob, &main, "?abc").await;
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert_eq!(state.polls.count(), 0);
    assert_eq!(state.sockets.count(device), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_long_poll_editor_notices_a_dropped_network_and_catches_up_after() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start_with(&mut bob, link(&pair, &pair.bob, project), quick());
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    proxy.go_offline();
    let cut = tokio::time::Instant::now();
    until_event(&mut alice, |event| {
        matches!(event, LiveEvent::Status(LiveStatus::Offline { .. }))
    })
    .await;
    assert!(
        cut.elapsed() < Duration::from_secs(6),
        "{:?}",
        cut.elapsed()
    );
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "~", 3))
        .unwrap();
    lock(&bob.live)
        .editor_change(&main, 0, insert(3, "!", 3))
        .unwrap();
    bob.handle.as_ref().unwrap().flush();
    proxy.go_online();
    until_status(&mut alice, LiveStatus::Online).await;
    until_text(&bob, &main, "~abc!").await;
    until_text(&alice, &main, "~abc!").await;
}

async fn frames_of_an_unknown_type_are_skipped_and_the_ones_around_them_arrive(blocked: bool) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let upstream = pair
        ._server
        .url()
        .trim_start_matches("http://")
        .parse()
        .unwrap();
    let later = oleafly_server::test_support::FutureFrames::start(upstream).await;
    let proxy = oleafly_server::test_support::BlockingProxy::start(later.address()).await;
    proxy.block_websockets(blocked);
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    let mut before = Vec::new();
    tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(event) = alice.events.recv().await {
            let online = event == LiveEvent::Status(LiveStatus::Online);
            before.push(event);
            if online {
                return;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("Alice never came online, she heard {before:?}"));
    let mut heard = Vec::new();
    for word in [" one", " two"] {
        append(&bob, &main, word);
        flushed(&bob);
        acknowledged(&bob).await;
    }
    until_text(&alice, &main, "abc one two").await;
    append(&alice, &main, " three");
    flushed(&alice);
    until_text(&bob, &main, "abc one two three").await;
    acknowledged(&alice).await;
    assert!(
        later.injected() >= 4,
        "{} unknown frames were sent",
        later.injected()
    );
    while let Ok(event) = alice.events.try_recv() {
        heard.push(event);
    }
    for event in &heard {
        assert!(
            matches!(event, LiveEvent::Changed | LiveEvent::Acknowledged),
            "after coming online Alice heard {event:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_frame_of_an_unknown_type_is_skipped_and_the_frames_around_it_arrive_over_a_socket() {
    frames_of_an_unknown_type_are_skipped_and_the_ones_around_them_arrive(false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_frame_of_an_unknown_type_is_skipped_and_the_frames_around_it_arrive_in_long_poll_batches(
) {
    frames_of_an_unknown_type_are_skipped_and_the_ones_around_them_arrive(true).await;
}

async fn turning_away_upgrades(upstream: std::net::SocketAddr, refusals: usize) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let left = Arc::new(std::sync::atomic::AtomicUsize::new(refusals));
    tokio::spawn(async move {
        while let Ok((mut client, _)) = listener.accept().await {
            let left = Arc::clone(&left);
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut buffer = [0u8; 4096];
                while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                    match client.read(&mut buffer).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => head.extend_from_slice(&buffer[..read]),
                    }
                }
                let upgrade = String::from_utf8_lossy(&head)
                    .to_ascii_lowercase()
                    .contains("upgrade: websocket");
                let refuse = upgrade
                    && left
                        .fetch_update(
                            std::sync::atomic::Ordering::SeqCst,
                            std::sync::atomic::Ordering::SeqCst,
                            |count| count.checked_sub(1),
                        )
                        .is_ok();
                if refuse {
                    let _ = client
                        .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await;
                    return;
                }
                let Ok(mut server) = tokio::net::TcpStream::connect(upstream).await else {
                    return;
                };
                if server.write_all(&head).await.is_ok() {
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                }
            });
        }
    });
    format!("http://{address}")
}

#[tokio::test(flavor = "multi_thread")]
async fn a_socket_turned_away_right_after_a_fresh_token_is_tried_again_instead_of_signing_out() {
    let pair = two_people().await;
    let (project, main, _bob_live, alice_live) = shared(&pair).await;
    let upstream = pair
        ._server
        .url()
        .trim_start_matches("http://")
        .parse()
        .unwrap();
    let front = turning_away_upgrades(upstream, 3).await;
    let mut alice = side(alice_live, &main);
    let mut through = link(&pair, &pair.alice, project);
    through.client = Arc::new(ServerClient::new(crate::ServerUrl::parse(&front).unwrap()).unwrap());
    start_with(&mut alice, through, quick());
    let reached = until_event(&mut alice, |event| {
        matches!(
            event,
            LiveEvent::Status(LiveStatus::Online | LiveStatus::Ended { .. })
        )
    })
    .await;
    assert_eq!(reached, LiveEvent::Status(LiveStatus::Online));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_socket_the_server_refuses_with_its_own_401_is_tried_once_after_a_refresh_then_signs_out()
{
    use crate::client::test_util::{refusal_with, UpgradeFront};
    let pair = two_people().await;
    let (project, main, _bob_live, alice_live) = shared(&pair).await;
    let front = UpgradeFront::start(
        &pair.url,
        Some(refusal_with("401 Unauthorized", "unauthorized")),
    )
    .await;
    let mut alice = side(alice_live, &main);
    let mut through = link(&pair, &pair.alice, project);
    through.client = Arc::new(ServerClient::new(front.url.clone()).unwrap());
    start_with(&mut alice, through, quick());
    let reached = until_event(&mut alice, |event| {
        matches!(
            event,
            LiveEvent::Status(LiveStatus::Online | LiveStatus::Ended { .. })
        )
    })
    .await;
    assert_eq!(
        reached,
        LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::SignedOut
        })
    );
    let upgrades = front.upgrades();
    assert_eq!(upgrades.len(), 2, "{upgrades:?}");
    let renewed = pair
        .alice
        .sessions
        .tokens(pair.server_id)
        .unwrap()
        .expect("the session is still stored")
        .access_token;
    assert_ne!(renewed, pair.alice.tokens.access_token);
    assert!(upgrades[1].contains(&renewed));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_long_poll_editor_keeps_reading_while_its_own_posts_cross_a_slow_link() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let upstream = pair
        ._server
        .url()
        .trim_start_matches("http://")
        .parse()
        .unwrap();
    let slow = slow_link(upstream, Duration::from_millis(100)).await;
    let blocking = oleafly_server::test_support::BlockingProxy::start(slow).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &blocking),
        quick(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = alice.events.recv().await {
            if event == LiveEvent::Status(LiveStatus::Online) {
                return;
            }
        }
    })
    .await
    .expect("Alice came online over long-poll");
    assert_eq!(pair._server.state().polls.count(), 1);
    let handle = alice.handle.as_ref().unwrap();
    for cursor in 0..60u32 {
        handle.presence(PresenceState {
            file_id: Some(main.clone()),
            cursor: Some(cursor),
            anchor: None,
        });
    }
    for round in 0..40 {
        append(&bob, &main, &format!(" {round}"));
        flushed(&bob);
        acknowledged(&bob).await;
    }
    let typed = tokio::time::Instant::now();
    let wanted = text(&bob, &main);
    tokio::time::timeout(Duration::from_secs(30), async {
        while text(&alice, &main) != wanted {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("Alice caught up");
    let behind = typed.elapsed();
    assert!(
        behind < Duration::from_secs(3),
        "Alice saw Bob's last change {behind:?} after he typed it"
    );
}
