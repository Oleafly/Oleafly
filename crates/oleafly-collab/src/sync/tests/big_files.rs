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
