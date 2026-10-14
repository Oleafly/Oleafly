mod people;

use oleafly_collab_protocol::frames::{
    ClientFrame, FrameErrorCode, MemberChange, MemberChangeKind, ServerFrame,
};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use oleafly_server::test_support::{test_config, TestDevice};
use people::{
    call, connect, envelope, grant, next_frame, put_bytes, send_frame, send_update, share_project,
    signed_by, stage, stage_with, subscribe, told_of_removal, Stage,
};
use reqwest::{Method, StatusCode};

async fn shared_with_alice(
    stage: &Stage,
    role: ProjectRole,
) -> oleafly_collab_protocol::ids::SharedProjectId {
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    assert_eq!(
        grant(&stage.server, &stage.bob, project, &stage.alice, role)
            .await
            .status(),
        StatusCode::OK
    );
    project
}

#[tokio::test]
async fn an_update_is_acknowledged_and_reaches_the_others() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    assert_eq!(
        subscribe(&mut bob, project, 0).await,
        ServerFrame::Subscribed {
            project_id: project,
            role: ProjectRole::Owner,
            head_seq: 0,
            since_batch: None
        }
    );
    assert_eq!(
        subscribe(&mut alice, project, 0).await,
        ServerFrame::Subscribed {
            project_id: project,
            role: ProjectRole::Editor,
            head_seq: 0,
            since_batch: None
        }
    );
    let change = envelope(&stage.bob, project, b"hello");
    send_update(&mut bob, &change).await;
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Ack {
            project_id: project,
            batch_id: change.batch_id,
            seq: 1
        })
    );
    assert_eq!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Update {
            project_id: project,
            seq: 1,
            account_id: Some(stage.bob.tokens.account_id),
            envelope: change
        })
    );
}

#[tokio::test]
async fn a_late_subscriber_catches_up_from_the_backlog() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let first = envelope(&stage.bob, project, b"one");
    let second = envelope(&stage.bob, project, b"two");
    for change in [&first, &second] {
        send_update(&mut bob, change).await;
        assert!(matches!(
            next_frame(&mut bob).await,
            Some(ServerFrame::Ack { .. })
        ));
    }
    let mut alice = connect(&stage.server, &stage.alice).await;
    assert!(matches!(
        subscribe(&mut alice, project, 1).await,
        ServerFrame::Subscribed { head_seq: 2, .. }
    ));
    assert_eq!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Update {
            project_id: project,
            seq: 2,
            account_id: Some(stage.bob.tokens.account_id),
            envelope: second
        })
    );
}

#[tokio::test]
async fn a_repeated_change_is_acknowledged_again_but_not_sent_twice() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut bob, project, 0).await;
    subscribe(&mut alice, project, 0).await;
    let change = envelope(&stage.bob, project, b"once");
    for _ in 0..2 {
        send_update(&mut bob, &change).await;
        assert!(matches!(
            next_frame(&mut bob).await,
            Some(ServerFrame::Ack { seq: 1, .. })
        ));
    }
    assert!(matches!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Update { seq: 1, .. })
    ));
    let here = PresenceState {
        file_id: Some("main".to_owned()),
        cursor: Some(4),
        anchor: None,
    };
    send_frame(
        &mut bob,
        &ClientFrame::Presence {
            project_id: project,
            state: here.clone(),
        },
    )
    .await;
    assert_eq!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Presence {
            project_id: project,
            device_id: stage.bob.tokens.device_id,
            account_id: stage.bob.tokens.account_id,
            state: here
        })
    );
}

#[tokio::test]
async fn a_viewer_cannot_change_the_project() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Viewer).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    assert!(matches!(
        subscribe(&mut alice, project, 0).await,
        ServerFrame::Subscribed {
            role: ProjectRole::Viewer,
            ..
        }
    ));
    send_update(&mut alice, &envelope(&stage.alice, project, b"nope")).await;
    assert!(matches!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Forbidden,
            ..
        })
    ));
}

#[tokio::test]
async fn a_change_signed_by_another_key_is_refused() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let thief = TestDevice::generate();
    send_update(&mut bob, &signed_by(&stage.bob, &thief, project, b"forged")).await;
    assert!(matches!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Unauthorized,
            ..
        })
    ));
}

#[tokio::test]
async fn changes_need_an_open_project_and_access() {
    let stage = stage().await;
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    let mut alice = connect(&stage.server, &stage.alice).await;
    assert!(matches!(
        subscribe(&mut alice, project, 0).await,
        ServerFrame::Error {
            code: FrameErrorCode::NotFound,
            ..
        }
    ));
    send_update(&mut alice, &envelope(&stage.alice, project, b"sneak")).await;
    assert!(matches!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Forbidden,
            ..
        })
    ));
}

#[tokio::test]
async fn removing_someone_tells_them_and_the_room() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut bob, project, 0).await;
    subscribe(&mut alice, project, 0).await;
    let path = format!(
        "/api/v1/projects/{project}/members/{}",
        stage.alice.tokens.account_id
    );
    assert_eq!(
        call(
            &stage.server,
            Method::DELETE,
            &path,
            stage.bob.token(),
            None
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        next_frame(&mut alice).await,
        Some(ServerFrame::AccessChanged {
            project_id: project,
            role: None,
            change: Some(MemberChange {
                account_id: stage.alice.tokens.account_id,
                by: stage.bob.tokens.account_id,
                kind: MemberChangeKind::Removed,
            }),
            comments: None,
        })
    );
    assert_eq!(
        told_of_removal(&mut bob).await,
        vec![
            ServerFrame::AccessChanged {
                project_id: project,
                role: Some(ProjectRole::Owner),
                change: Some(MemberChange {
                    account_id: stage.alice.tokens.account_id,
                    by: stage.bob.tokens.account_id,
                    kind: MemberChangeKind::Removed,
                }),
                comments: None,
            },
            ServerFrame::PresenceLeft {
                project_id: project,
                device_id: stage.alice.tokens.device_id
            },
        ]
    );
    send_update(&mut alice, &envelope(&stage.alice, project, b"after")).await;
    assert!(matches!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Forbidden,
            ..
        })
    ));
}

#[tokio::test]
async fn a_new_role_reaches_the_person_while_they_are_connected() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut alice, project, 0).await;
    grant(
        &stage.server,
        &stage.bob,
        project,
        &stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(
        next_frame(&mut alice).await,
        Some(ServerFrame::AccessChanged {
            project_id: project,
            role: Some(ProjectRole::Viewer),
            change: Some(MemberChange {
                account_id: stage.alice.tokens.account_id,
                by: stage.bob.tokens.account_id,
                kind: MemberChangeKind::RoleChanged,
            }),
            comments: None,
        })
    );
}

#[tokio::test]
async fn stopping_sharing_tells_everyone_in_the_room() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut bob, project, 0).await;
    subscribe(&mut alice, project, 0).await;
    let path = format!("/api/v1/projects/{project}/archive");
    call(&stage.server, Method::POST, &path, stage.bob.token(), None).await;
    for socket in [&mut bob, &mut alice] {
        assert_eq!(
            next_frame(socket).await,
            Some(ServerFrame::ProjectArchived {
                project_id: project
            })
        );
    }
    assert!(matches!(
        subscribe(&mut alice, project, 0).await,
        ServerFrame::Error {
            code: FrameErrorCode::NotFound,
            ..
        }
    ));
}

#[tokio::test]
async fn closing_a_connection_tells_the_room() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut bob, project, 0).await;
    subscribe(&mut alice, project, 0).await;
    drop(alice);
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::PresenceLeft {
            project_id: project,
            device_id: stage.alice.tokens.device_id
        })
    );
}

#[tokio::test]
async fn hiding_tells_the_room_the_person_left_and_keeps_them_subscribed() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut bob, project, 0).await;
    subscribe(&mut alice, project, 0).await;
    send_frame(
        &mut alice,
        &ClientFrame::Presence {
            project_id: project,
            state: PresenceState {
                file_id: Some("main".to_owned()),
                cursor: Some(1),
                anchor: None,
            },
        },
    )
    .await;
    assert!(matches!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Presence { .. })
    ));
    send_frame(
        &mut alice,
        &ClientFrame::PresenceLeave {
            project_id: project,
        },
    )
    .await;
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::PresenceLeft {
            project_id: project,
            device_id: stage.alice.tokens.device_id
        })
    );
    send_frame(&mut alice, &ClientFrame::Ping { id: 7 }).await;
    assert_eq!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Pong { id: 7 })
    );
    send_update(&mut bob, &envelope(&stage.bob, project, b"still here")).await;
    assert!(matches!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Update { seq: 1, .. })
    ));
}

#[tokio::test]
async fn a_compacted_log_asks_for_the_snapshot_first() {
    let stage = stage().await;
    stage
        .server
        .state()
        .snapshots
        .set_policy(oleafly_server::snapshots::Policy {
            build_after: 1,
            keep_updates: 1,
        });
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    for payload in [b"one".as_slice(), b"two", b"three"] {
        send_update(&mut bob, &envelope(&stage.bob, project, payload)).await;
        assert!(matches!(
            next_frame(&mut bob).await,
            Some(ServerFrame::Ack { .. })
        ));
    }
    for seq in [2, 3] {
        let path = format!("/api/v1/projects/{project}/snapshot?seq={seq}");
        assert_eq!(
            put_bytes(&stage.server, &path, stage.bob.token(), b"state".to_vec())
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
    }
    let mut alice = connect(&stage.server, &stage.alice).await;
    assert_eq!(
        subscribe(&mut alice, project, 0).await,
        ServerFrame::SnapshotRequired {
            project_id: project
        }
    );
    assert!(matches!(
        subscribe(&mut alice, project, 2).await,
        ServerFrame::Subscribed { head_seq: 3, .. }
    ));
    assert!(matches!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Update { seq: 3, .. })
    ));
}

#[tokio::test]
async fn a_flood_of_cursor_updates_is_thinned_and_never_pushes_anyone_off() {
    let stage = stage().await;
    let project = shared_with_alice(&stage, ProjectRole::Viewer).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut bob, project, 0).await;
    subscribe(&mut alice, project, 0).await;
    let started = tokio::time::Instant::now();
    for cursor in 0..5_000u32 {
        send_frame(
            &mut alice,
            &ClientFrame::Presence {
                project_id: project,
                state: PresenceState {
                    file_id: Some("main".to_owned()),
                    cursor: Some(cursor),
                    anchor: None,
                },
            },
        )
        .await;
    }
    send_frame(&mut alice, &ClientFrame::Ping { id: 1 }).await;
    loop {
        match next_frame(&mut alice).await {
            Some(ServerFrame::Pong { id: 1 }) => break,
            Some(ServerFrame::Presence { .. } | ServerFrame::PresenceLeft { .. }) => {}
            other => panic!("expected a pong, got {other:?}"),
        }
    }
    let flooding = started.elapsed();
    send_update(&mut bob, &envelope(&stage.bob, project, b"after the flood")).await;
    let mut forwarded = 0u32;
    loop {
        match next_frame(&mut bob).await {
            Some(ServerFrame::Ack { .. }) => break,
            Some(ServerFrame::Presence { .. }) => forwarded += 1,
            Some(ServerFrame::PresenceLeft { .. }) => {}
            other => panic!("bob was pushed off or got {other:?}"),
        }
    }
    let allowed = 20.0 + 10.0 * flooding.as_secs_f64() + 1.0;
    assert!(
        f64::from(forwarded) <= allowed,
        "{forwarded} of 5000 cursor updates reached Bob in {flooding:?}"
    );
    let mut viewer = connect(&stage.server, &stage.alice).await;
    assert!(matches!(
        subscribe(&mut viewer, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    assert_eq!(
        stage
            .server
            .state()
            .sockets
            .count(stage.bob.tokens.device_id),
        1
    );
}

#[tokio::test]
async fn a_change_past_the_project_size_limit_is_refused_and_says_why() {
    let mut config = test_config();
    config.limits.max_project_mb = 1;
    let stage = stage_with(config).await;
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    subscribe(&mut alice, project, 0).await;
    let text = vec![b'a'; 400 * 1024];
    send_update(&mut alice, &envelope(&stage.alice, project, &text)).await;
    assert!(matches!(
        next_frame(&mut alice).await,
        Some(ServerFrame::Ack { seq: 1, .. })
    ));
    send_update(&mut alice, &envelope(&stage.alice, project, &text)).await;
    match next_frame(&mut alice).await {
        Some(ServerFrame::Error {
            code: FrameErrorCode::TooLarge,
            message,
        }) => assert!(message.contains("OLEAFLY_MAX_PROJECT_MB"), "{message}"),
        other => panic!("expected the size limit, got {other:?}"),
    }
}
