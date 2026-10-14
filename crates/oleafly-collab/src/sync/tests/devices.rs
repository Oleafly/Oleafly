use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_device_seen_first_is_checked_after_one_refresh_and_a_later_one_is_announced() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    assert!(lock(&bob.live).devices().is_empty());
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "!", 3))
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    assert_eq!(
        next_message(&mut bob).await,
        DocMessage::Remote {
            rev: 1,
            op: insert(0, "!", 3),
            length: 4
        }
    );
    assert_eq!(
        lock(&bob.live)
            .devices()
            .account_of(pair.alice.tokens.device_id),
        Some(pair.alice.tokens.account_id)
    );
    while let Ok(event) = bob.events.try_recv() {
        assert!(!matches!(event, LiveEvent::NewDevice { .. }), "{event:?}");
    }
    let second = another_alice_device(&pair).await;
    let client = ServerClient::new(pair.url.clone()).unwrap();
    let (seq, snapshot) = client
        .get_snapshot(&second.tokens.access_token, project)
        .await
        .unwrap();
    let mut tablet = side(
        LiveProject::new(
            ProjectDoc::load(&snapshot).unwrap(),
            seq,
            ProjectRole::Editor,
        ),
        &main,
    );
    start(&mut tablet, link(&pair, &second, project));
    until_text(&tablet, &main, "!abc").await;
    assert!(matches!(
        next_message(&mut tablet).await,
        DocMessage::Remote { rev: 1, .. }
    ));
    lock(&tablet.live)
        .editor_change(&main, 1, insert(4, "?", 4))
        .unwrap();
    tablet.handle.as_ref().unwrap().flush();
    let announced = until_event(&mut bob, |event| {
        matches!(event, LiveEvent::NewDevice { .. })
    })
    .await;
    assert_eq!(
        announced,
        LiveEvent::NewDevice {
            account_id: pair.alice.tokens.account_id,
            device_id: second.tokens.device_id,
        }
    );
    until_text(&bob, &main, "!abc?").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_badly_signed_update_is_refused_and_syncing_goes_on() {
    let pair = two_people().await;
    let (project, main, bob_live, mut alice_live) = shared(&pair).await;
    let client = ServerClient::new(pair.url.clone()).unwrap();
    let (_, snapshot) = client
        .get_snapshot(&pair.alice.tokens.access_token, project)
        .await
        .unwrap();
    let mut forger = LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, ProjectRole::Editor);
    forger.local_text(&main, "EVILabc").unwrap();
    let forged = forger.next_outgoing().unwrap().unwrap().payload;
    alice_live.local_text(&main, "abcX").unwrap();
    let honest = alice_live.next_outgoing().unwrap().unwrap().payload;
    let mut tampered = signed_envelope(&pair.alice, project, honest.clone());
    tampered.payload = forged;
    store_on_server(&pair, &pair.alice, tampered).await;
    store_on_server(
        &pair,
        &pair.alice,
        signed_envelope(&pair.alice, project, honest),
    )
    .await;
    let mut bob = side(bob_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    let refused = until_event(&mut bob, |event| {
        matches!(event, LiveEvent::Untrusted { .. })
    })
    .await;
    assert_eq!(
        refused,
        LiveEvent::Untrusted {
            device_id: pair.alice.tokens.device_id,
            seq: 1,
        }
    );
    until_text(&bob, &main, "abcX").await;
    assert_eq!(lock(&bob.live).last_seq(), 2);
    lock(&bob.live)
        .editor_change(&main, 1, insert(4, "!", 4))
        .unwrap();
    bob.handle.as_ref().unwrap().flush();
    until_event(&mut bob, |event| *event == LiveEvent::Acknowledged).await;
    assert_eq!(text(&bob, &main), "abcX!");
    assert!(!bob.handle.as_ref().unwrap().is_finished());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_device_list_the_server_cannot_give_never_drops_an_update() {
    let pair = two_people().await;
    let (project, main, bob_live, mut alice_live) = shared(&pair).await;
    alice_live.local_text(&main, "abcX").unwrap();
    let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
    let envelope = signed_envelope(&pair.alice, project, payload);
    let bob = side(bob_live, &main);
    for status in [
        "404 Not Found",
        "403 Forbidden",
        "400 Bad Request",
        "200 OK",
    ] {
        let body = if status.starts_with("200") {
            "not json"
        } else {
            r#"{"code":"not_found","message":"Not found."}"#
        };
        let answer = canned(http_response(
            status,
            &[("content-type", "application/json")],
            body,
        ))
        .await;
        let mut older = link(&pair, &pair.bob, project);
        older.client = Arc::new(ServerClient::new(answer).unwrap());
        let verdict = trust(
            &older,
            &bob.live,
            &bob.events_tx,
            &mut Refreshed::default(),
            &envelope,
            Some(pair.alice.tokens.account_id),
        )
        .await;
        assert!(
            matches!(verdict, Trust::Unreachable),
            "{status} must retry, not refuse"
        );
    }
    assert_eq!(lock(&bob.live).last_seq(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_update_signed_for_another_project_is_refused() {
    let pair = two_people().await;
    let (project, main, bob_live, mut alice_live) = shared(&pair).await;
    alice_live.local_text(&main, "abcX").unwrap();
    let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
    let elsewhere = signed_envelope(&pair.alice, SharedProjectId::new_v7(), payload.clone());
    store_in_project(&pair, &pair.alice, project, elsewhere).await;
    store_on_server(
        &pair,
        &pair.alice,
        signed_envelope(&pair.alice, project, payload),
    )
    .await;
    let mut bob = side(bob_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    let refused = until_event(&mut bob, |event| {
        matches!(event, LiveEvent::Untrusted { .. })
    })
    .await;
    assert_eq!(
        refused,
        LiveEvent::Untrusted {
            device_id: pair.alice.tokens.device_id,
            seq: 1,
        }
    );
    until_text(&bob, &main, "abcX").await;
    assert_eq!(lock(&bob.live).last_seq(), 2);
}

fn forged_by(base: &ProjectDoc, peer: u64, main: &str, text: &str) -> Vec<u8> {
    let mut forger = ProjectDoc::load(&base.snapshot().unwrap()).unwrap();
    let since = forger.version();
    forger.loro().set_peer_id(peer).unwrap();
    forger.set_text(main, text).unwrap();
    forger.export_since(&since).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_change_forged_under_another_devices_writer_id_is_refused_and_both_copies_converge() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "!", 3))
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    until_text(&bob, &main, "!abc").await;
    stopped(&mut alice).await;
    stopped(&mut bob).await;
    lock(&alice.live)
        .local_text(&main, "!abc written by Alice offline")
        .unwrap();
    let alice_peer = lock(&alice.live).doc().loro().peer_id();
    let forged = forged_by(lock(&bob.live).doc(), alice_peer, &main, "!abc FORGED");
    store_on_server(
        &pair,
        &pair.bob,
        signed_envelope(&pair.bob, project, forged),
    )
    .await;
    start(&mut bob, link(&pair, &pair.bob, project));
    let refused = until_event(&mut bob, |event| {
        matches!(event, LiveEvent::Untrusted { .. })
    })
    .await;
    assert_eq!(
        refused,
        LiveEvent::Untrusted {
            device_id: pair.bob.tokens.device_id,
            seq: 2,
        }
    );
    assert_eq!(text(&bob, &main), "!abc");
    start(&mut alice, link(&pair, &pair.alice, project));
    until_text(&bob, &main, "!abc written by Alice offline").await;
    until_text(&alice, &main, "!abc written by Alice offline").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_change_under_this_copys_own_writer_id_is_always_refused() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let alice_peer = alice_live.doc().loro().peer_id();
    let forged = forged_by(bob_live.doc(), alice_peer, &main, "abc FORGED");
    store_on_server(
        &pair,
        &pair.bob,
        signed_envelope(&pair.bob, project, forged),
    )
    .await;
    let mut alice = side(alice_live, &main);
    start(&mut alice, link(&pair, &pair.alice, project));
    let refused = until_event(&mut alice, |event| {
        matches!(event, LiveEvent::Untrusted { .. })
    })
    .await;
    assert_eq!(
        refused,
        LiveEvent::Untrusted {
            device_id: pair.bob.tokens.device_id,
            seq: 1,
        }
    );
    assert_eq!(text(&alice, &main), "abc");
    assert_eq!(lock(&alice.live).last_seq(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_relayed_resend_from_an_honest_editor_still_converges() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    let start_version = lock(&bob.live).doc().version();
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "!", 3))
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    until_text(&bob, &main, "!abc").await;
    stopped(&mut bob).await;
    stopped(&mut alice).await;
    let relayed = {
        let mut live = lock(&bob.live);
        live.local_text(&main, "!abc and Bob").unwrap();
        live.doc().export_since(&start_version).unwrap()
    };
    store_on_server(
        &pair,
        &pair.bob,
        signed_envelope(&pair.bob, project, relayed),
    )
    .await;
    start(&mut alice, link(&pair, &pair.alice, project));
    until_text(&alice, &main, "!abc and Bob").await;
    start(&mut bob, link(&pair, &pair.bob, project));
    until_status(&mut bob, LiveStatus::Online).await;
    lock(&alice.live)
        .local_text(&main, "!abc and Bob!")
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    until_text(&bob, &main, "!abc and Bob!").await;
    assert_eq!(text(&alice, &main), "!abc and Bob!");
    assert!(!lock(&bob.live).has_unsent());
}
