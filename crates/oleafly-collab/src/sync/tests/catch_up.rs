use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn catching_up_after_time_away_reports_who_changed_which_file_and_how() {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    lock(&alice.live)
        .editor_change(&main, 0, insert(0, "!", 3))
        .unwrap();
    alice.handle.as_ref().unwrap().flush();
    assert!(matches!(
        next_message(&mut alice).await,
        DocMessage::Ack { .. }
    ));
    until_text(&bob, &main, "!abc").await;
    tokio::time::timeout(WAIT, async {
        while lock(&alice.live).has_unsent() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("acknowledged");
    alice.handle.take().unwrap().stopped().await;
    assert!(matches!(
        next_message(&mut bob).await,
        DocMessage::Remote { .. }
    ));
    for (rev, letter) in ["d", "e"].into_iter().enumerate() {
        let length = 4 + rev;
        lock(&bob.live)
            .editor_change(&main, 1 + rev as u64, insert(length, letter, length))
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
    start(&mut alice, link(&pair, &pair.alice, project));
    let LiveEvent::Merged(report) =
        until_event(&mut alice, |event| matches!(event, LiveEvent::Merged(_))).await
    else {
        unreachable!()
    };
    assert_eq!(report.files.get(&main), Some(&2));
    assert_eq!(
        report
            .authors
            .get(&pair.bob.tokens.account_id)
            .and_then(|files| files.get(&main)),
        Some(&2)
    );
    assert_eq!(report.authors.len(), 1);
    let reviewed =
        crate::review::changed_files(lock(&alice.live).doc(), &report.before, &report.after)
            .unwrap();
    assert_eq!(
        reviewed,
        vec![crate::review::ReviewedFile {
            id: main.clone(),
            path: "main.tex".to_owned(),
            before: Some("!abc".to_owned()),
            after: Some("!abcde".to_owned()),
        }]
    );
}

fn typed_apart(start: &[u8], main: &str, writers: u64, edits: usize) -> Vec<Vec<u8>> {
    let writers: Vec<loro::LoroDoc> = (0..writers)
        .map(|index| {
            let writer = loro::LoroDoc::new();
            writer.import(start).unwrap();
            writer.set_peer_id(u64::MAX - 1 - index).unwrap();
            writer
        })
        .collect();
    let mut stream = Vec::new();
    for edit in 0..edits {
        for (index, writer) in writers.iter().enumerate() {
            let peer = writer.peer_id();
            let from = writer.oplog_vv().get(&peer).copied().unwrap_or(0);
            let text = writer.get_text(format!("text:{main}"));
            let at = (edit * 7_919 + index * 131) % (text.len_unicode() + 1);
            text.insert(at, &format!("[w{index} e{edit}]")).unwrap();
            writer.commit();
            let to = writer.oplog_vv().get(&peer).copied().unwrap_or(0);
            stream.push(
                writer
                    .export(loro::ExportMode::UpdatesInRange {
                        spans: std::borrow::Cow::Owned(vec![loro::IdSpan::new(peer, from, to)]),
                    })
                    .unwrap(),
            );
        }
    }
    stream
}

#[tokio::test(flavor = "multi_thread")]
async fn a_copy_with_a_large_file_catches_up_on_a_backlog_of_concurrent_typing_within_a_few_batch_imports(
) {
    let pair = two_people().await;
    let (project, main, mut bob_live, alice_live) = shared(&pair).await;
    let before_big = bob_live.doc().snapshot().unwrap();
    let since = bob_live.doc().version();
    let big = "a line of the large bibliography file\n".repeat(40_000);
    bob_live
        .doc_mut()
        .add_node(None, "big.tex", NodeKind::Text, None, &big)
        .unwrap();
    let big_update = bob_live.doc().export_since(&since).unwrap();
    store_on_server(
        &pair,
        &pair.bob,
        signed_envelope(&pair.bob, project, big_update),
    )
    .await;
    let with_big = bob_live.doc().snapshot().unwrap();
    let stream = typed_apart(&before_big, &main, 4, 40);
    for payload in &stream {
        store_on_server(
            &pair,
            &pair.bob,
            signed_envelope(&pair.bob, project, payload.clone()),
        )
        .await;
    }
    let plain = loro::LoroDoc::new();
    plain.import(&with_big).unwrap();
    let begun = std::time::Instant::now();
    plain.import_batch(&stream).unwrap();
    let plain_batch = begun.elapsed();
    let wanted = plain.oplog_vv();
    let alice_live = LiveProject::new(
        ProjectDoc::load(&with_big).unwrap(),
        alice_live.last_seq(),
        ProjectRole::Editor,
    );
    let mut alice = side(alice_live, &main);
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    let begun = tokio::time::Instant::now();
    let allowed = plain_batch * 12 + Duration::from_secs(2);
    while !lock(&alice.live).doc().version().includes_vv(&wanted) && begun.elapsed() < allowed {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let took = begun.elapsed();
    let arrived = lock(&alice.live).received();
    assert!(
        took <= allowed && lock(&alice.live).doc().version().includes_vv(&wanted),
        "after {took:?} Alice had taken in {arrived} of the {} stored changes, one plain batch import of them took {plain_batch:?}",
        stream.len() + 1
    );
    assert_eq!(
        text(&alice, &main),
        plain.get_text(format!("text:{main}")).to_string()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_snapshot_that_does_not_load_falls_back_to_the_one_before_and_the_kept_log() {
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
        until_event(&mut bob, |event| *event == LiveEvent::Acknowledged).await;
    }
    let client = ServerClient::new(pair.url.clone()).unwrap();
    client
        .put_snapshot(&pair.bob.tokens.access_token, project, 2, Vec::new())
        .await
        .unwrap();
    let state = pair._server.state().clone();
    state
        .snapshots
        .upload(
            &state.db,
            project,
            3,
            b"left by an older editor".to_vec().into(),
            pair.bob.tokens.account_id,
            1,
        )
        .await
        .unwrap();
    start(&mut alice, link(&pair, &pair.alice, project));
    until_text(&alice, &main, "abcxyz").await;
    assert_eq!(lock(&alice.live).last_seq(), 3);
}
