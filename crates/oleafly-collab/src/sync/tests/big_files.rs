use super::*;

const BIG_WAIT: Duration = Duration::from_secs(300);

async fn four_big_files_reach_the_other_editor(blocked: bool) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    proxy.block_websockets(blocked);
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
    let files: Vec<(String, String)> = {
        let mut live = lock(&bob.live);
        (0..4u64)
            .map(|index| {
                let body = noise(3 * 1024 * 1024, index + 1);
                let id = live
                    .doc_mut()
                    .add_node(
                        None,
                        &format!("part{index}.tex"),
                        NodeKind::Text,
                        None,
                        &body,
                    )
                    .unwrap();
                (id, body)
            })
            .collect()
    };
    flushed(&bob);
    tokio::time::timeout(BIG_WAIT, async {
        loop {
            let arrived = {
                let live = lock(&alice.live);
                files.iter().all(|(id, body)| {
                    live.doc().contains(id)
                        && live
                            .doc()
                            .text_of(id)
                            .is_ok_and(|text| text.len_unicode() == body.len())
                })
            };
            if arrived {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("all four files reached Alice");
    for (id, body) in &files {
        assert_eq!(&lock(&alice.live).doc().text(id).unwrap(), body);
    }
    acknowledged(&bob).await;
    append(&bob, &main, "!");
    flushed(&bob);
    until_text(&alice, &main, "abc!").await;
    assert_eq!(dropped(&mut bob), 0, "Bob's connection dropped");
    assert_eq!(dropped(&mut alice), 0, "Alice's connection dropped");
}

#[tokio::test(flavor = "multi_thread")]
async fn four_three_megabyte_files_added_at_once_reach_the_other_editor_over_a_socket() {
    four_big_files_reach_the_other_editor(false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn four_three_megabyte_files_added_at_once_reach_the_other_editor_over_long_poll() {
    four_big_files_reach_the_other_editor(true).await;
}

fn impatient() -> TransportOptions {
    TransportOptions {
        ping_every: Duration::from_millis(500),
        quiet_for: Duration::from_secs(2),
        ..quick()
    }
}

async fn on_a_slow_uplink(pair: &Pair) -> (SharedProjectId, String, Side, Side) {
    let (project, main, bob_live, alice_live) = shared(pair).await;
    let upstream = pair
        ._server
        .url()
        .trim_start_matches("http://")
        .parse()
        .unwrap();
    let slow = throttled_link(upstream, Some(32 * 1024), None).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start_with(
        &mut bob,
        link_through(pair, &pair.bob, project, slow),
        impatient(),
    );
    start(&mut alice, link(pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    (project, main, bob, alice)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_large_change_on_a_slow_uplink_is_acknowledged_without_reconnecting() {
    let pair = two_people().await;
    let (_project, _main, mut bob, alice) = on_a_slow_uplink(&pair).await;
    let body = noise(200 * 1024, 21);
    let refs = lock(&bob.live)
        .doc_mut()
        .add_node(None, "refs.bib", NodeKind::Text, None, &body)
        .unwrap();
    flushed(&bob);
    tokio::time::timeout(Duration::from_secs(90), async {
        while lock(&bob.live).has_unsent() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the change was acknowledged");
    assert_eq!(dropped(&mut bob), 0, "Bob's connection dropped on the way");
    tokio::time::timeout(WAIT, async {
        while lock(&alice.live).doc().text(&refs).ok().as_deref() != Some(body.as_str()) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the change reached Alice");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_large_change_on_a_slow_downlink_arrives_without_reconnecting() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let upstream = pair
        ._server
        .url()
        .trim_start_matches("http://")
        .parse()
        .unwrap();
    let slow = throttled_link(upstream, None, Some(128 * 1024)).await;
    let mut bob = side(bob_live, &main);
    let alice = side(alice_live, &main);
    start_with(
        &mut bob,
        link_through(&pair, &pair.bob, project, slow),
        impatient(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    let body = noise(600 * 1024, 23);
    let refs = lock(&alice.live)
        .doc_mut()
        .add_node(None, "refs.bib", NodeKind::Text, None, &body)
        .unwrap();
    let mut alice = alice;
    start(&mut alice, link(&pair, &pair.alice, project));
    tokio::time::timeout(Duration::from_secs(90), async {
        while lock(&bob.live).doc().text(&refs).ok().as_deref() != Some(body.as_str()) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the change reached Bob");
    assert_eq!(dropped(&mut bob), 0, "Bob's connection dropped on the way");
}

#[tokio::test(flavor = "multi_thread")]
async fn typing_sent_on_reconnect_waits_out_a_long_backlog_without_reconnecting() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut alice = side(alice_live, &main);
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    let body = noise(600 * 1024, 31);
    let refs = lock(&alice.live)
        .doc_mut()
        .add_node(None, "refs.bib", NodeKind::Text, None, &body)
        .unwrap();
    flushed(&alice);
    acknowledged(&alice).await;
    let mut bob = side(bob_live, &main);
    append(&bob, &main, " mine");
    let upstream = pair
        ._server
        .url()
        .trim_start_matches("http://")
        .parse()
        .unwrap();
    let slow = throttled_link(upstream, None, Some(128 * 1024)).await;
    let options = impatient();
    start_with(
        &mut bob,
        link_through(&pair, &pair.bob, project, slow),
        options,
    );
    until_status(&mut bob, LiveStatus::Online).await;
    let started = tokio::time::Instant::now();
    tokio::time::timeout(Duration::from_secs(90), async {
        loop {
            let done = {
                let live = lock(&bob.live);
                !live.has_unsent() && live.doc().text(&refs).ok().as_deref() == Some(body.as_str())
            };
            if done {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the backlog came in and Bob's typing was acknowledged");
    assert!(
        started.elapsed() > options.quiet_for,
        "the backlog took {:?}, no longer than the quiet window",
        started.elapsed()
    );
    assert_eq!(dropped(&mut bob), 0, "Bob's connection dropped on the way");
    until_text(&alice, &main, "abc mine").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn stopping_while_a_large_change_is_still_going_up_ends_the_session_at_once() {
    let pair = two_people().await;
    let (_project, _main, mut bob, _alice) = on_a_slow_uplink(&pair).await;
    let body = noise(2 * 1024 * 1024, 22);
    lock(&bob.live)
        .doc_mut()
        .add_node(None, "refs.bib", NodeKind::Text, None, &body)
        .unwrap();
    flushed(&bob);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let asked = tokio::time::Instant::now();
    bob.handle.as_ref().unwrap().stop();
    until_status(
        &mut bob,
        LiveStatus::Ended {
            reason: EndReason::Stopped,
        },
    )
    .await;
    assert!(
        asked.elapsed() < Duration::from_secs(5),
        "stopping took {:?}",
        asked.elapsed()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_too_large_for_any_batch_is_reported_once_and_the_connection_stays_up() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    lock(&bob.live).set_batch_limit(16 * 1024);
    start(&mut bob, link(&pair, &pair.bob, project));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    append(&bob, &main, "d");
    {
        let mut live = lock(&bob.live);
        let huge = noise(64 * 1024, 5);
        let doc = live.comment_doc().loro();
        doc.get_map("oversized")
            .insert("value", huge.as_str())
            .unwrap();
        doc.commit();
    }
    flushed(&bob);
    until_text(&alice, &main, "abcd").await;
    until_event(&mut bob, |event| *event == LiveEvent::Unsendable).await;
    flushed(&bob);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut again = 0;
    while let Ok(event) = bob.events.try_recv() {
        assert!(
            !matches!(event, LiveEvent::Status(LiveStatus::Offline { .. })),
            "{event:?}"
        );
        again += usize::from(event == LiveEvent::Unsendable);
    }
    assert_eq!(again, 0, "the refusal was reported again");
    assert!(!bob.handle.as_ref().unwrap().is_finished());
}
