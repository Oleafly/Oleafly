use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn two_editors_see_each_others_typing_through_the_server() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
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
    let here = PresenceState {
        file_id: Some(main.clone()),
        cursor: Some(2),
        anchor: None,
    };
    alice.handle.as_ref().unwrap().presence(here.clone());
    tokio::time::timeout(WAIT, async {
        while let Some(event) = bob.events.recv().await {
            if let LiveEvent::Presence { state, .. } = event {
                assert_eq!(state, here);
                return;
            }
        }
    })
    .await
    .expect("presence arrived");
}

#[tokio::test(flavor = "multi_thread")]
async fn hiding_tells_the_others_this_device_left_after_its_last_presence() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    let handle = alice.handle.as_ref().unwrap();
    handle.presence(PresenceState {
        file_id: Some(main.clone()),
        cursor: Some(1),
        anchor: None,
    });
    handle.leave_presence();
    left_without_a_later_cursor(&mut bob, pair.alice.tokens.device_id).await;
    assert!(!alice.handle.as_ref().unwrap().is_finished());
}

// The server keeps only the latest cursor or leave of each device beside its
// edit queue, so a cursor sent just before leaving may be folded into the
// leave. Waits for the leave and checks that no cursor of that device comes
// after it.
pub(super) async fn left_without_a_later_cursor(side: &mut Side, device: DeviceId) {
    tokio::time::timeout(WAIT, async {
        while let Some(event) = side.events.recv().await {
            if matches!(event, LiveEvent::PresenceLeft { device_id } if device_id == device) {
                return;
            }
        }
    })
    .await
    .expect("the leave arrived");
    let later = tokio::time::timeout(Duration::from_millis(500), async {
        while let Some(event) = side.events.recv().await {
            if matches!(&event, LiveEvent::Presence { device_id, .. } if *device_id == device) {
                return event;
            }
        }
        std::future::pending().await
    })
    .await;
    assert!(
        later.is_err(),
        "a cursor arrived after the leave: {later:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_acknowledged_change_is_reported_so_waiting_counts_can_update() {
    let pair = two_people().await;
    let (project, main, bob_live, _alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    until_status(&mut bob, LiveStatus::Online).await;
    lock(&bob.live)
        .editor_change(&main, 0, insert(0, "x", 3))
        .unwrap();
    bob.handle.as_ref().unwrap().flush();
    tokio::time::timeout(WAIT, async {
        while let Some(event) = bob.events.recv().await {
            if event == LiveEvent::Acknowledged {
                return;
            }
        }
    })
    .await
    .expect("the acknowledgement was reported");
    assert_eq!(lock(&bob.live).pending_changes(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn edits_made_offline_sync_after_reconnecting() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    until_status(&mut bob, LiveStatus::Online).await;
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "offline ", 3))
        .unwrap();
    lock(&bob.live)
        .editor_change(&main, 0, insert(3, " online", 3))
        .unwrap();
    bob.handle.as_ref().unwrap().flush();
    assert!(matches!(
        next_message(&mut bob).await,
        DocMessage::Ack { .. }
    ));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    tokio::time::timeout(WAIT, async {
        loop {
            if text(&bob, &main) == "offline abc online"
                && text(&alice, &main) == text(&bob, &main)
                && !lock(&alice.live).has_unsent()
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("both sides converged and the offline edit was acknowledged");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_removed_person_is_told_and_stops_syncing() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let _bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    let client = ServerClient::new(pair.url.clone()).unwrap();
    client
        .remove_member(
            &pair.bob.tokens.access_token,
            project,
            pair.alice.tokens.account_id,
        )
        .await
        .unwrap();
    until_status(
        &mut alice,
        LiveStatus::Ended {
            reason: EndReason::Removed,
        },
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_person_far_behind_catches_up_from_the_snapshot() {
    let pair = two_people().await;
    snapshot_often(&pair);
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    until_status(&mut bob, LiveStatus::Online).await;
    for (rev, letter) in ["x", "y", "z"].into_iter().enumerate() {
        let length = 3 + rev;
        lock(&bob.live)
            .editor_change(&main, rev as u64, insert(length, letter, length))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        assert!(matches!(
            next_message(&mut bob).await,
            DocMessage::Ack { .. }
        ));
        tokio::time::timeout(WAIT, async {
            while lock(&bob.live).has_unsent() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("acknowledged");
    }
    let client = ServerClient::new(pair.url.clone()).unwrap();
    let snapshot = lock(&bob.live).doc().snapshot().unwrap();
    for seq in [2, 3] {
        client
            .put_snapshot(
                &pair.bob.tokens.access_token,
                project,
                seq,
                snapshot.clone(),
            )
            .await
            .unwrap();
    }
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    assert_eq!(text(&alice, &main), "abcxyz");
    assert_eq!(lock(&alice.live).last_seq(), 3);
}

async fn stored_updates(pair: &Pair, project: SharedProjectId) -> i64 {
    pair._server
        .state()
        .db
        .call(move |conn| {
            Ok::<_, oleafly_server::error::ServerError>(conn.query_row(
                "SELECT COUNT(*) FROM project_updates WHERE project_id = ?1",
                [project.to_string()],
                |row| row.get::<_, i64>(0),
            )?)
        })
        .await
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_batch_the_server_took_just_before_the_app_quit_is_stored_once() {
    let pair = two_people().await;
    let (project, main, mut bob_live, _alice_live) = shared(&pair).await;
    bob_live
        .local_text(&main, "abc sent before quitting")
        .unwrap();
    let outgoing = bob_live.next_outgoing().unwrap().unwrap();
    let mut envelope = signed_envelope(&pair.bob, project, outgoing.payload.clone());
    envelope.batch_id = outgoing.batch;
    envelope.signature = pair.bob.key.sign(&envelope.signing_bytes()).to_vec();
    store_in_project(&pair, &pair.bob, project, envelope).await;
    let dir = tempfile::tempdir().unwrap();
    bob_live.save(dir.path()).unwrap();
    drop(bob_live);
    let restarted = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
    let mut bob = side(restarted, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    until_status(&mut bob, LiveStatus::Online).await;
    acknowledged(&bob).await;
    assert_eq!(stored_updates(&pair, project).await, 1);
    stopped(&mut bob).await;
}
