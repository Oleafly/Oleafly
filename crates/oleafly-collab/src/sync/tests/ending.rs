use super::*;

async fn ended_after(
    blocked: bool,
    refuse: impl for<'a> Fn(&'a Pair, SharedProjectId) -> futures_util::future::BoxFuture<'a, ()>,
) -> LiveEvent {
    let pair = two_people().await;
    let (project, main, _bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    proxy.block_websockets(blocked);
    let mut alice = side(alice_live, &main);
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut alice, LiveStatus::Online).await;
    assert_eq!(pair._server.state().polls.count(), usize::from(blocked));
    refuse(&pair, project).await;
    until_event(&mut alice, |event| {
        matches!(event, LiveEvent::Status(LiveStatus::Ended { .. }))
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn removal_and_sign_out_end_live_sync_the_same_way_over_both_transports() {
    for blocked in [false, true] {
        let removed = ended_after(blocked, |pair, project| {
            Box::pin(async move {
                ServerClient::new(pair.url.clone())
                    .unwrap()
                    .remove_member(
                        &pair.bob.tokens.access_token,
                        project,
                        pair.alice.tokens.account_id,
                    )
                    .await
                    .unwrap();
            })
        })
        .await;
        assert_eq!(
            removed,
            LiveEvent::Status(LiveStatus::Ended {
                reason: EndReason::Removed
            }),
            "blocked: {blocked}"
        );
        let signed_out = ended_after(blocked, |pair, _| {
            Box::pin(async move {
                ServerClient::new(pair.url.clone())
                    .unwrap()
                    .sign_out_device(&pair.alice.tokens.access_token, pair.alice.tokens.device_id)
                    .await
                    .unwrap();
            })
        })
        .await;
        assert_eq!(
            signed_out,
            LiveEvent::Status(LiveStatus::Ended {
                reason: EndReason::SignedOut
            }),
            "blocked: {blocked}"
        );
    }
}

async fn suspend(pair: &Pair, status: oleafly_collab_protocol::admin::MemberStatus) {
    ServerClient::new(pair.url.clone())
        .unwrap()
        .admin_patch_member(
            &pair.bob.tokens.access_token,
            pair.alice.tokens.account_id,
            &oleafly_collab_protocol::admin::MemberPatch {
                role: None,
                status: Some(status),
            },
        )
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn suspension_and_removal_from_the_server_end_live_sync_with_their_reason() {
    for blocked in [false, true] {
        let suspended = ended_after(blocked, |pair, _| {
            Box::pin(suspend(
                pair,
                oleafly_collab_protocol::admin::MemberStatus::Suspended,
            ))
        })
        .await;
        assert_eq!(
            suspended,
            LiveEvent::Status(LiveStatus::Ended {
                reason: EndReason::AccountSuspended
            }),
            "blocked: {blocked}"
        );
        let ended = ended_after(blocked, |pair, _| {
            Box::pin(async move {
                ServerClient::new(pair.url.clone())
                    .unwrap()
                    .admin_remove_member(
                        &pair.bob.tokens.access_token,
                        pair.alice.tokens.account_id,
                    )
                    .await
                    .unwrap();
            })
        })
        .await;
        assert_eq!(
            ended,
            LiveEvent::Status(LiveStatus::Ended {
                reason: EndReason::AccessEnded
            }),
            "blocked: {blocked}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_suspension_heard_live_forgets_the_saved_session() {
    let pair = two_people().await;
    let (project, main, _bob_live, alice_live) = shared(&pair).await;
    let mut alice = side(alice_live, &main);
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    suspend(
        &pair,
        oleafly_collab_protocol::admin::MemberStatus::Suspended,
    )
    .await;
    until_status(
        &mut alice,
        LiveStatus::Ended {
            reason: EndReason::AccountSuspended,
        },
    )
    .await;
    assert!(pair
        .alice
        .sessions
        .tokens(pair.server_id)
        .unwrap()
        .is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_suspension_while_away_is_named_on_the_next_connection() {
    let pair = two_people().await;
    let (project, main, _bob_live, alice_live) = shared(&pair).await;
    suspend(
        &pair,
        oleafly_collab_protocol::admin::MemberStatus::Suspended,
    )
    .await;
    let mut alice = side(alice_live, &main);
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(
        &mut alice,
        LiveStatus::Ended {
            reason: EndReason::AccountSuspended,
        },
    )
    .await;
    assert!(pair
        .alice
        .sessions
        .tokens(pair.server_id)
        .unwrap()
        .is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_people_who_stay_hear_who_removed_whom() {
    let pair = two_people().await;
    let (project, main, bob_live, _alice_live) = shared(&pair).await;
    let mut bob = side(bob_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    until_status(&mut bob, LiveStatus::Online).await;
    ServerClient::new(pair.url.clone())
        .unwrap()
        .remove_member(
            &pair.bob.tokens.access_token,
            project,
            pair.alice.tokens.account_id,
        )
        .await
        .unwrap();
    let heard = until_event(&mut bob, |event| matches!(event, LiveEvent::Members(_))).await;
    assert_eq!(
        heard,
        LiveEvent::Members(MemberChange {
            account_id: pair.alice.tokens.account_id,
            by: pair.bob.tokens.account_id,
            kind: MemberChangeKind::Removed,
        })
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_removed_person_hears_who_removed_them_before_sync_ends() {
    let pair = two_people().await;
    let (project, main, _bob_live, alice_live) = shared(&pair).await;
    let mut alice = side(alice_live, &main);
    start(&mut alice, link(&pair, &pair.alice, project));
    until_status(&mut alice, LiveStatus::Online).await;
    ServerClient::new(pair.url.clone())
        .unwrap()
        .remove_member(
            &pair.bob.tokens.access_token,
            project,
            pair.alice.tokens.account_id,
        )
        .await
        .unwrap();
    let heard = until_event(&mut alice, |event| {
        matches!(
            event,
            LiveEvent::Members(_) | LiveEvent::Status(LiveStatus::Ended { .. })
        )
    })
    .await;
    assert_eq!(
        heard,
        LiveEvent::Members(MemberChange {
            account_id: pair.alice.tokens.account_id,
            by: pair.bob.tokens.account_id,
            kind: MemberChangeKind::Removed,
        })
    );
    until_status(
        &mut alice,
        LiveStatus::Ended {
            reason: EndReason::Removed,
        },
    )
    .await;
}
