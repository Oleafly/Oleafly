use super::*;

async fn switch_comments(pair: &Pair, project: SharedProjectId, server_wide: bool, on: bool) {
    if server_wide {
        ServerClient::new(pair.url.clone())
            .unwrap()
            .admin_patch_settings(
                &pair.bob.tokens.access_token,
                &oleafly_collab_protocol::admin::RuntimeSettingsPatch {
                    comments_allowed: Some(on),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
    } else {
        set_project_comments(pair, project, on).await;
    }
}

async fn a_member_hears_comments_switched_within_seconds(blocked: bool, server_wide: bool) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
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
    back_online(&mut alice).await;
    for on in [false, true, false, true] {
        switch_comments(&pair, project, server_wide, on).await;
        let heard = tokio::time::timeout(PROMPTLY, async {
            loop {
                match alice.events.recv().await {
                    Some(LiveEvent::Comments(switches)) => return switches,
                    Some(_) => {}
                    None => panic!("Alice's events ended"),
                }
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!("Alice was not told within {PROMPTLY:?} that comments were turned on: {on}")
        });
        assert_eq!(
            heard,
            CommentSwitches {
                server: on || !server_wide,
                project: on || server_wide,
            }
        );
    }
    lock(&alice.live)
        .comment_doc()
        .create_comment_thread(
            &main,
            0,
            3,
            pair.alice.tokens.account_id,
            1,
            "comments are back",
            &[],
        )
        .unwrap();
    flushed(&alice);
    until(|| {
        lock(&bob.live)
            .doc()
            .comment_threads(&main)
            .is_ok_and(|threads| threads.len() == 1)
    })
    .await;
    assert!(!alice
        .events
        .try_recv()
        .is_ok_and(|event| matches!(event, LiveEvent::CommentsNotSent(_))));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_hears_project_comments_turned_off_and_on_within_seconds_over_a_socket() {
    a_member_hears_comments_switched_within_seconds(false, false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_hears_project_comments_turned_off_and_on_within_seconds_over_long_poll() {
    a_member_hears_comments_switched_within_seconds(true, false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_hears_server_comments_turned_off_and_on_within_seconds_over_a_socket() {
    a_member_hears_comments_switched_within_seconds(false, true).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_hears_server_comments_turned_off_and_on_within_seconds_over_long_poll() {
    a_member_hears_comments_switched_within_seconds(true, true).await;
}
