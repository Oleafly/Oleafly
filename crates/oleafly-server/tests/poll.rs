mod people;

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method as HttpMethod, Request, StatusCode as HttpStatus};
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose, SessionEndReason};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{
    ClientFrame, FrameErrorCode, MemberChange, MemberChangeKind, ServerFrame,
};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::poll::{
    PollBatch, PollFrames, PollReplies, DEVICE_HEADER, NONCE_HEADER, POLL_KEY_HEADER,
    PROTOCOL_HEADER, SIGNATURE_HEADER,
};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use oleafly_server::build_router;
use oleafly_server::config::{ConfigError, ServerConfig};
use oleafly_server::rate_limit::CONNECT_BURST;
use oleafly_server::test_support::{
    challenge_nonce, test_app, test_app_with, TestDevice, TestServer,
};
use oleafly_server::transfers::UploadTiming;
use people::{
    beside, call, connect, envelope, grant, large_change, longest_stall, next_frame, put_bytes,
    seeded, send_frame, send_update, share_project, signed_by, stage, subscribe, Person, Stage,
    LONGEST_STALL,
};
use reqwest::{Method, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;

const WAIT: Duration = Duration::from_secs(5);

struct Poller {
    base: String,
    project: SharedProjectId,
    key: String,
    cursor: String,
}

fn poll_url(server: &TestServer, project: SharedProjectId) -> String {
    format!("{}/api/v1/projects/{project}/poll", server.url())
}

async fn open_with(
    server: &TestServer,
    person: &Person,
    project: SharedProjectId,
    since: u64,
    signer: &TestDevice,
    protocol: u32,
) -> reqwest::Response {
    let nonce = challenge_nonce(server).await;
    let signature = signer.sign_b64(&challenge_message(
        ChallengePurpose::Socket,
        server.state().server_id,
        &nonce,
    ));
    reqwest::Client::new()
        .get(poll_url(server, project))
        .query(&[("since", since.to_string())])
        .bearer_auth(person.token())
        .header(DEVICE_HEADER, person.tokens.device_id.to_string())
        .header(NONCE_HEADER, nonce)
        .header(SIGNATURE_HEADER, signature)
        .header(PROTOCOL_HEADER, protocol.to_string())
        .send()
        .await
        .expect("open request")
}

async fn open(
    server: &TestServer,
    person: &Person,
    project: SharedProjectId,
    since: u64,
) -> (Option<Poller>, Vec<ServerFrame>) {
    let response = open_with(
        server,
        person,
        project,
        since,
        &person.device,
        PROTOCOL_VERSION,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let batch: PollBatch = response.json().await.expect("poll batch");
    let poller = match (batch.key, batch.cursor) {
        (Some(key), Some(cursor)) => Some(Poller {
            base: server.url(),
            project,
            key,
            cursor,
        }),
        _ => None,
    };
    (poller, batch.frames)
}

async fn opened(server: &TestServer, person: &Person, project: SharedProjectId) -> Poller {
    let (poller, frames) = open(server, person, project, 0).await;
    assert!(
        matches!(frames.first(), Some(ServerFrame::Subscribed { .. })),
        "{frames:?}"
    );
    poller.expect("an open session")
}

impl Poller {
    async fn get(&self, cursor: &str, key: &str) -> reqwest::Response {
        reqwest::Client::new()
            .get(format!(
                "{}/api/v1/projects/{}/poll",
                self.base, self.project
            ))
            .query(&[("cursor", cursor)])
            .header(POLL_KEY_HEADER, key)
            .send()
            .await
            .expect("poll request")
    }

    async fn poll_at(&mut self, cursor: &str) -> Vec<ServerFrame> {
        let response = self.get(cursor, &self.key.clone()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let batch: PollBatch = response.json().await.expect("poll batch");
        assert_eq!(batch.key, None);
        if let Some(cursor) = batch.cursor {
            self.cursor = cursor;
        }
        batch.frames
    }

    async fn poll(&mut self) -> Vec<ServerFrame> {
        let cursor = self.cursor.clone();
        self.poll_at(&cursor).await
    }

    async fn status(&self) -> StatusCode {
        self.get(&self.cursor, &self.key).await.status()
    }

    async fn collect(&mut self, count: usize) -> Vec<ServerFrame> {
        let deadline = Instant::now() + WAIT;
        let mut frames = Vec::new();
        while frames.len() < count {
            assert!(Instant::now() < deadline, "only got {frames:?}");
            frames.extend(self.poll().await);
        }
        frames
    }

    async fn next(&mut self) -> ServerFrame {
        let mut frames = self.collect(1).await;
        assert_eq!(frames.len(), 1, "{frames:?}");
        frames.remove(0)
    }

    async fn post_with(&self, key: &str, frames: Vec<ClientFrame>) -> reqwest::Response {
        reqwest::Client::new()
            .post(format!(
                "{}/api/v1/projects/{}/frames",
                self.base, self.project
            ))
            .header(POLL_KEY_HEADER, key)
            .json(&PollFrames { frames })
            .send()
            .await
            .expect("frames request")
    }

    async fn post(&self, frames: Vec<ClientFrame>) -> Vec<ServerFrame> {
        let response = self.post_with(&self.key, frames).await;
        assert_eq!(response.status(), StatusCode::OK);
        let replies: PollReplies = response.json().await.expect("replies");
        replies.frames
    }
}

fn quick(stage: &Stage) {
    stage
        .server
        .state()
        .polls
        .set_timing(Duration::from_millis(300), Duration::from_secs(30));
}

async fn shared_with_alice(stage: &Stage, role: ProjectRole) -> SharedProjectId {
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

fn update(envelope: &oleafly_collab_protocol::envelope::Envelope) -> ClientFrame {
    ClientFrame::Update {
        project_id: envelope.project_id,
        envelope: envelope.clone(),
    }
}

fn here(cursor: u32) -> PresenceState {
    PresenceState {
        file_id: Some("main".to_owned()),
        cursor: Some(cursor),
        anchor: None,
    }
}

#[tokio::test]
async fn a_change_over_long_poll_is_acknowledged_and_reaches_a_socket_peer() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let (alice, frames) = open(&stage.server, &stage.alice, project, 0).await;
    assert_eq!(
        frames,
        vec![ServerFrame::Subscribed {
            project_id: project,
            role: ProjectRole::Editor,
            head_seq: 0,
            since_batch: None
        }]
    );
    let alice = alice.expect("a session");
    let change = envelope(&stage.alice, project, b"hello");
    assert_eq!(
        alice.post(vec![update(&change)]).await,
        vec![ServerFrame::Ack {
            project_id: project,
            batch_id: change.batch_id,
            seq: 1
        }]
    );
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Update {
            project_id: project,
            seq: 1,
            account_id: Some(stage.alice.tokens.account_id),
            envelope: change
        })
    );
}

#[tokio::test]
async fn socket_changes_reach_a_long_poll_peer_in_order() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    let mut sent = Vec::new();
    for payload in [b"one".as_slice(), b"two", b"three"] {
        let change = envelope(&stage.bob, project, payload);
        send_update(&mut bob, &change).await;
        assert!(matches!(
            next_frame(&mut bob).await,
            Some(ServerFrame::Ack { .. })
        ));
        sent.push(change);
    }
    let received = alice.collect(3).await;
    let expected: Vec<ServerFrame> = sent
        .into_iter()
        .enumerate()
        .map(|(index, change)| ServerFrame::Update {
            project_id: project,
            seq: index as u64 + 1,
            account_id: Some(stage.bob.tokens.account_id),
            envelope: change,
        })
        .collect();
    assert_eq!(received, expected);
}

#[tokio::test]
async fn opening_late_catches_up_from_the_backlog() {
    let stage = stage().await;
    quick(&stage);
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
    let (alice, frames) = open(&stage.server, &stage.alice, project, 1).await;
    assert!(alice.is_some());
    assert_eq!(
        frames,
        vec![
            ServerFrame::Subscribed {
                project_id: project,
                role: ProjectRole::Editor,
                head_seq: 2,
                since_batch: Some(first.batch_id)
            },
            ServerFrame::Update {
                project_id: project,
                seq: 2,
                account_id: Some(stage.bob.tokens.account_id),
                envelope: second
            }
        ]
    );
}

#[tokio::test]
async fn a_compacted_log_asks_for_the_snapshot_before_opening() {
    let stage = stage().await;
    stage
        .server
        .state()
        .snapshots
        .set_policy(oleafly_server::snapshots::Policy {
            build_after: 1,
            keep_updates: 1,
        });
    quick(&stage);
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
    let (none, frames) = open(&stage.server, &stage.alice, project, 0).await;
    assert!(none.is_none());
    assert_eq!(
        frames,
        vec![ServerFrame::SnapshotRequired {
            project_id: project
        }]
    );
    assert_eq!(stage.server.state().polls.count(), 0);
    let (alice, frames) = open(&stage.server, &stage.alice, project, 2).await;
    assert!(alice.is_some());
    assert!(matches!(
        frames.as_slice(),
        [
            ServerFrame::Subscribed { head_seq: 3, .. },
            ServerFrame::Update { seq: 3, .. }
        ]
    ));
}

#[tokio::test]
async fn a_repeated_change_is_acknowledged_again_but_not_sent_twice() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    let change = envelope(&stage.alice, project, b"once");
    for _ in 0..2 {
        assert!(matches!(
            alice.post(vec![update(&change)]).await.as_slice(),
            [ServerFrame::Ack { seq: 1, .. }]
        ));
    }
    assert!(matches!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Update { seq: 1, .. })
    ));
    send_frame(&mut bob, &ClientFrame::Ping { id: 1 }).await;
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Pong { id: 1 })
    );
}

#[tokio::test]
async fn presence_and_leaving_travel_between_socket_and_long_poll() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    assert_eq!(
        alice
            .post(vec![
                ClientFrame::Presence {
                    project_id: project,
                    state: here(4),
                },
                ClientFrame::Ping { id: 9 },
            ])
            .await,
        vec![ServerFrame::Pong { id: 9 }]
    );
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Presence {
            project_id: project,
            device_id: stage.alice.tokens.device_id,
            account_id: stage.alice.tokens.account_id,
            state: here(4)
        })
    );
    assert!(alice
        .post(vec![ClientFrame::PresenceLeave {
            project_id: project
        }])
        .await
        .is_empty());
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::PresenceLeft {
            project_id: project,
            device_id: stage.alice.tokens.device_id
        })
    );
    send_frame(
        &mut bob,
        &ClientFrame::Presence {
            project_id: project,
            state: here(7),
        },
    )
    .await;
    assert_eq!(
        alice.next().await,
        ServerFrame::Presence {
            project_id: project,
            device_id: stage.bob.tokens.device_id,
            account_id: stage.bob.tokens.account_id,
            state: here(7)
        }
    );
    let long = PresenceState {
        file_id: Some("x".repeat(300)),
        cursor: None,
        anchor: None,
    };
    assert!(matches!(
        alice
            .post(vec![ClientFrame::Presence {
                project_id: project,
                state: long
            }])
            .await
            .as_slice(),
        [ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            ..
        }]
    ));
}

#[tokio::test]
async fn a_viewer_cannot_change_the_project_over_long_poll() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Viewer).await;
    let (alice, frames) = open(&stage.server, &stage.alice, project, 0).await;
    assert!(matches!(
        frames.as_slice(),
        [ServerFrame::Subscribed {
            role: ProjectRole::Viewer,
            ..
        }]
    ));
    let alice = alice.expect("a session");
    assert!(matches!(
        alice
            .post(vec![update(&envelope(&stage.alice, project, b"nope"))])
            .await
            .as_slice(),
        [ServerFrame::Error {
            code: FrameErrorCode::Forbidden,
            ..
        }]
    ));
}

#[tokio::test]
async fn badly_signed_or_misaddressed_changes_are_refused() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    let thief = TestDevice::generate();
    let forged = signed_by(&stage.alice, &thief, project, b"forged");
    let elsewhere = SharedProjectId::new_v7();
    let misaddressed = envelope(&stage.alice, elsewhere, b"lost");
    let replies = alice
        .post(vec![
            update(&forged),
            ClientFrame::Update {
                project_id: project,
                envelope: misaddressed.clone(),
            },
            update(&misaddressed),
            ClientFrame::Subscribe {
                project_id: project,
                since_seq: 0,
            },
        ])
        .await;
    let codes: Vec<FrameErrorCode> = replies
        .into_iter()
        .map(|frame| match frame {
            ServerFrame::Error { code, .. } => code,
            other => panic!("expected an error, got {other:?}"),
        })
        .collect();
    assert_eq!(
        codes,
        vec![
            FrameErrorCode::Unauthorized,
            FrameErrorCode::BadFrame,
            FrameErrorCode::Forbidden,
            FrameErrorCode::BadFrame
        ]
    );
}

#[tokio::test]
async fn a_change_too_large_is_refused_like_on_the_socket() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    let huge = envelope(&stage.alice, project, &vec![7u8; 8 * 1024 * 1024 + 1]);
    assert!(matches!(
        alice.post(vec![update(&huge)]).await.as_slice(),
        [ServerFrame::Error {
            code: FrameErrorCode::TooLarge,
            ..
        }]
    ));
}

// The server runs on the test's only thread, so a ping that waits shows the
// server's thread was busy with the large change rather than beside it.
#[tokio::test(flavor = "current_thread")]
async fn a_large_change_over_long_poll_does_not_hold_up_other_connections() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let large = large_change(&stage.alice, project);
    let alice = opened(&stage.server, &stage.alice, project).await;
    let mut bob = opened(&stage.server, &stage.bob, project).await;
    let carol = seeded(&stage.server, "Carol").await;
    let mut pinger = connect(&stage.server, &carol).await;
    let (work, done) =
        beside(async move { tokio::join!(alice.post(vec![update(&large)]), bob.collect(1)) });
    let stall = longest_stall(&mut pinger, &done).await;
    let (answer, arrived) = work.await.expect("the clients ran");
    assert!(
        matches!(answer.as_slice(), [ServerFrame::Ack { seq: 1, .. }]),
        "{answer:?}"
    );
    assert!(matches!(
        arrived.as_slice(),
        [ServerFrame::Update { seq: 1, .. }]
    ));
    assert!(
        stall < LONGEST_STALL,
        "the server's thread was held for {stall:?} while a large change was posted and polled"
    );
}

#[tokio::test]
async fn opening_without_access_reads_as_not_found() {
    let stage = stage().await;
    quick(&stage);
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    let (none, frames) = open(&stage.server, &stage.alice, project, 0).await;
    assert!(none.is_none());
    assert!(matches!(
        frames.as_slice(),
        [ServerFrame::Error {
            code: FrameErrorCode::NotFound,
            ..
        }]
    ));
    assert_eq!(stage.server.state().polls.count(), 0);
}

#[tokio::test]
async fn opening_needs_a_valid_session_and_proof_of_the_device_key() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let server = &stage.server;
    let unsigned = reqwest::Client::new()
        .get(poll_url(server, project))
        .send()
        .await
        .expect("request");
    assert_eq!(unsigned.status(), StatusCode::UNAUTHORIZED);
    let thief = TestDevice::generate();
    let stolen = open_with(server, &stage.alice, project, 0, &thief, PROTOCOL_VERSION).await;
    assert_eq!(stolen.status(), StatusCode::UNAUTHORIZED);
    let nonce = challenge_nonce(server).await;
    let signature = stage.alice.device.sign_b64(&challenge_message(
        ChallengePurpose::Socket,
        server.state().server_id,
        &nonce,
    ));
    let mut statuses = Vec::new();
    for _ in 0..2 {
        let response = reqwest::Client::new()
            .get(poll_url(server, project))
            .bearer_auth(stage.alice.token())
            .header(DEVICE_HEADER, stage.alice.tokens.device_id.to_string())
            .header(NONCE_HEADER, &nonce)
            .header(SIGNATURE_HEADER, &signature)
            .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
            .send()
            .await
            .expect("request");
        statuses.push(response.status());
    }
    assert_eq!(statuses, vec![StatusCode::OK, StatusCode::UNAUTHORIZED]);
    let nonce = challenge_nonce(server).await;
    let mixed = reqwest::Client::new()
        .get(poll_url(server, project))
        .bearer_auth(stage.bob.token())
        .header(DEVICE_HEADER, stage.alice.tokens.device_id.to_string())
        .header(NONCE_HEADER, &nonce)
        .header(
            SIGNATURE_HEADER,
            stage.alice.device.sign_b64(&challenge_message(
                ChallengePurpose::Socket,
                server.state().server_id,
                &nonce,
            )),
        )
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
        .send()
        .await
        .expect("request");
    assert_eq!(mixed.status(), StatusCode::UNAUTHORIZED);
    let newer = open_with(
        server,
        &stage.alice,
        project,
        0,
        &stage.alice.device,
        PROTOCOL_VERSION + 1,
    )
    .await;
    assert_eq!(newer.status(), StatusCode::OK);
    let batch: PollBatch = newer.json().await.expect("batch");
    assert_eq!(batch.key, None);
    assert!(matches!(
        batch.frames.as_slice(),
        [ServerFrame::Error {
            code: FrameErrorCode::ProtocolMismatch,
            ..
        }]
    ));
}

#[tokio::test]
async fn signing_the_device_out_ends_its_long_poll() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    let path = format!("/api/v1/devices/{}", stage.alice.tokens.device_id);
    assert_eq!(
        call(
            &stage.server,
            Method::DELETE,
            &path,
            stage.alice.token(),
            None
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        alice.next().await,
        ServerFrame::SessionRevoked { reason: None }
    );
    assert_eq!(alice.status().await, StatusCode::NOT_FOUND);
    assert_eq!(stage.server.state().polls.count(), 0);
}

#[tokio::test]
async fn suspending_someone_tells_their_long_poll_why() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    let path = format!("/api/v1/admin/members/{}", stage.alice.tokens.account_id);
    assert_eq!(
        call(
            &stage.server,
            Method::PATCH,
            &path,
            stage.bob.token(),
            Some(serde_json::json!({ "status": "suspended" }))
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        alice.next().await,
        ServerFrame::SessionRevoked {
            reason: Some(SessionEndReason::AccountSuspended)
        }
    );
}

#[tokio::test]
async fn removing_someone_tells_their_long_poll_and_the_room() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
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
        alice.next().await,
        ServerFrame::AccessChanged {
            project_id: project,
            role: None,
            change: Some(MemberChange {
                account_id: stage.alice.tokens.account_id,
                by: stage.bob.tokens.account_id,
                kind: MemberChangeKind::Removed,
            }),
            comments: None,
        }
    );
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::PresenceLeft {
            project_id: project,
            device_id: stage.alice.tokens.device_id
        })
    );
    assert!(matches!(
        alice
            .post(vec![update(&envelope(&stage.alice, project, b"after"))])
            .await
            .as_slice(),
        [ServerFrame::Error {
            code: FrameErrorCode::Forbidden,
            ..
        }]
    ));
}

#[tokio::test]
async fn a_new_role_and_stopping_sharing_reach_a_long_poll() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    grant(
        &stage.server,
        &stage.bob,
        project,
        &stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(
        alice.next().await,
        ServerFrame::AccessChanged {
            project_id: project,
            role: Some(ProjectRole::Viewer),
            change: Some(MemberChange {
                account_id: stage.alice.tokens.account_id,
                by: stage.bob.tokens.account_id,
                kind: MemberChangeKind::RoleChanged,
            }),
            comments: None,
        }
    );
    let path = format!("/api/v1/projects/{project}/archive");
    call(&stage.server, Method::POST, &path, stage.bob.token(), None).await;
    assert_eq!(
        alice.next().await,
        ServerFrame::ProjectArchived {
            project_id: project
        }
    );
}

#[tokio::test]
async fn a_quiet_long_poll_expires_and_the_room_is_told() {
    let stage = stage().await;
    stage
        .server
        .state()
        .polls
        .set_timing(Duration::from_millis(200), Duration::from_millis(400));
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    let started = Instant::now();
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::PresenceLeft {
            project_id: project,
            device_id: stage.alice.tokens.device_id
        })
    );
    assert!(started.elapsed() >= Duration::from_millis(350));
    assert_eq!(alice.status().await, StatusCode::NOT_FOUND);
    assert_eq!(stage.server.state().polls.count(), 0);
    assert_eq!(stage.server.state().rooms.size(project), 1);
}

#[tokio::test]
async fn polling_keeps_a_long_poll_alive() {
    let stage = stage().await;
    stage
        .server
        .state()
        .polls
        .set_timing(Duration::from_millis(100), Duration::from_millis(1_500));
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    let until = Instant::now() + Duration::from_millis(3_500);
    while Instant::now() < until {
        assert!(alice.poll().await.is_empty());
    }
    assert_eq!(stage.server.state().polls.count(), 1);
    assert_eq!(stage.server.state().rooms.size(project), 1);
}

#[tokio::test]
async fn closing_a_long_poll_tells_the_room_at_once() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    assert!(alice
        .post(vec![ClientFrame::Unsubscribe {
            project_id: project
        }])
        .await
        .is_empty());
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::PresenceLeft {
            project_id: project,
            device_id: stage.alice.tokens.device_id
        })
    );
    assert_eq!(alice.status().await, StatusCode::NOT_FOUND);
    assert_eq!(
        stage
            .server
            .state()
            .sockets
            .count(stage.alice.tokens.device_id),
        0
    );
}

#[tokio::test]
async fn reopening_replaces_the_older_long_poll_of_the_same_device() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let stale = opened(&stage.server, &stage.alice, project).await;
    let mut fresh = opened(&stage.server, &stage.alice, project).await;
    assert_eq!(stale.status().await, StatusCode::NOT_FOUND);
    assert_eq!(stage.server.state().polls.count(), 1);
    assert_eq!(
        next_frame(&mut bob).await,
        Some(ServerFrame::PresenceLeft {
            project_id: project,
            device_id: stage.alice.tokens.device_id
        })
    );
    send_frame(
        &mut bob,
        &ClientFrame::Presence {
            project_id: project,
            state: here(3),
        },
    )
    .await;
    assert!(matches!(fresh.next().await, ServerFrame::Presence { .. }));
    assert_eq!(stage.server.state().rooms.size(project), 2);
}

#[tokio::test]
async fn a_batch_the_client_missed_is_sent_again() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    let before = alice.cursor.clone();
    let first = envelope(&stage.bob, project, b"one");
    send_update(&mut bob, &first).await;
    assert!(matches!(
        next_frame(&mut bob).await,
        Some(ServerFrame::Ack { .. })
    ));
    let delivered = alice.next().await;
    assert!(matches!(delivered, ServerFrame::Update { seq: 1, .. }));
    let after = alice.cursor.clone();
    assert_ne!(before, after);
    assert_eq!(alice.poll_at(&before).await, vec![delivered]);
    assert_eq!(alice.cursor, after);
    let second = envelope(&stage.bob, project, b"two");
    send_update(&mut bob, &second).await;
    assert!(matches!(
        alice.next().await,
        ServerFrame::Update { seq: 2, .. }
    ));
}

#[tokio::test]
async fn a_waiting_poll_comes_back_empty_after_the_hold() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    let cursor = alice.cursor.clone();
    let started = Instant::now();
    assert!(alice.poll().await.is_empty());
    let waited = started.elapsed();
    assert!(waited >= Duration::from_millis(250), "{waited:?}");
    assert!(waited < Duration::from_secs(3), "{waited:?}");
    assert_eq!(alice.cursor, cursor);
}

#[tokio::test]
async fn a_newer_poll_replaces_one_that_is_waiting() {
    let stage = stage().await;
    stage
        .server
        .state()
        .polls
        .set_timing(Duration::from_secs(20), Duration::from_secs(30));
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let alice = Arc::new(tokio::sync::Mutex::new(
        opened(&stage.server, &stage.alice, project).await,
    ));
    let (cursor, key) = {
        let poller = alice.lock().await;
        (poller.cursor.clone(), poller.key.clone())
    };
    let first = {
        let alice = Arc::clone(&alice);
        let (cursor, key) = (cursor.clone(), key.clone());
        tokio::spawn(async move {
            let started = Instant::now();
            let response = alice.lock().await.get(&cursor, &key).await;
            let batch: PollBatch = response.json().await.expect("batch");
            (batch.frames, started.elapsed())
        })
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    let second = {
        let poller = Poller {
            base: stage.server.url(),
            project,
            key: key.clone(),
            cursor: cursor.clone(),
        };
        tokio::spawn(async move { poller.get(&cursor, &key).await })
    };
    let (frames, waited) = tokio::time::timeout(WAIT, first)
        .await
        .expect("the first poll ended")
        .expect("task");
    assert!(frames.is_empty());
    assert!(waited < Duration::from_secs(5), "{waited:?}");
    send_update(&mut bob, &envelope(&stage.bob, project, b"later")).await;
    let response = tokio::time::timeout(WAIT, second)
        .await
        .expect("the second poll ended")
        .expect("task");
    let batch: PollBatch = response.json().await.expect("batch");
    assert!(matches!(
        batch.frames.as_slice(),
        [ServerFrame::Update { seq: 1, .. }]
    ));
}

#[tokio::test]
async fn requests_without_the_session_key_find_nothing() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    assert_eq!(
        alice.get(&alice.cursor, "not-the-key").await.status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        alice
            .post_with("not-the-key", vec![ClientFrame::Ping { id: 1 }])
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let other = shared_with_alice(&stage, ProjectRole::Editor).await;
    let wrong_project = Poller {
        base: alice.base.clone(),
        project: other,
        key: alice.key.clone(),
        cursor: alice.cursor.clone(),
    };
    assert_eq!(wrong_project.status().await, StatusCode::NOT_FOUND);
    assert_eq!(alice.status().await, StatusCode::OK);
}

#[tokio::test]
async fn posted_frames_whose_body_stops_arriving_end_after_the_upload_time() {
    let stage = stage().await;
    quick(&stage);
    stage.server.state().transfers.set_timing(UploadTiming {
        grace: Duration::from_millis(500),
        min_rate: u64::MAX,
    });
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    let address = stage.server.url().trim_start_matches("http://").to_owned();
    let mut stream = tokio::net::TcpStream::connect(&address)
        .await
        .expect("connect");
    let head = format!(
        "POST /api/v1/projects/{project}/frames HTTP/1.1\r\nHost: {address}\r\n{POLL_KEY_HEADER}: {}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{{\"frames\":[",
        alice.key
    );
    stream
        .write_all(head.as_bytes())
        .await
        .expect("send the head");
    let started = Instant::now();
    let mut answer = vec![0u8; 512];
    let read = tokio::time::timeout(WAIT, stream.read(&mut answer))
        .await
        .expect("the stalled post was answered")
        .expect("read the answer");
    let answer = String::from_utf8_lossy(&answer[..read]).into_owned();
    assert!(answer.starts_with("HTTP/1.1 400"), "{answer}");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(alice.status().await, StatusCode::OK);
}

#[tokio::test]
async fn a_device_signed_out_while_its_long_poll_opens_is_told_its_session_ended() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let state = stage.server.state();
    let pause = state.polls.pause_next_open();
    let device = stage.alice.tokens.device_id;
    let sign_out = async {
        pause.reached.notified().await;
        state.revoke_device(device).await.expect("sign out");
        pause.resume.notify_one();
    };
    let ((poller, frames), ()) =
        tokio::join!(open(&stage.server, &stage.alice, project, 0), sign_out);
    assert!(
        matches!(frames.first(), Some(ServerFrame::Subscribed { .. })),
        "{frames:?}"
    );
    let mut poller = poller.expect("the open finished before the sign-out reached it");
    assert_eq!(
        poller.next().await,
        ServerFrame::SessionRevoked { reason: None }
    );
}

#[tokio::test]
async fn a_long_poll_notices_a_sign_out_it_was_never_told_about() {
    let stage = stage().await;
    quick(&stage);
    stage
        .server
        .state()
        .polls
        .set_revocation_check(Duration::from_millis(100));
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut alice = opened(&stage.server, &stage.alice, project).await;
    let device = stage.alice.tokens.device_id;
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE devices SET revoked_at = 1 WHERE id = ?1",
                [device.to_string()],
            )?;
            Ok(())
        })
        .await
        .expect("revoke quietly");
    assert_eq!(
        alice.next().await,
        ServerFrame::SessionRevoked { reason: None }
    );
}

#[tokio::test]
async fn a_long_poll_that_falls_far_behind_is_dropped_and_can_catch_up() {
    let stage = stage().await;
    quick(&stage);
    let project = shared_with_alice(&stage, ProjectRole::Editor).await;
    let mut bob = connect(&stage.server, &stage.bob).await;
    subscribe(&mut bob, project, 0).await;
    let alice = opened(&stage.server, &stage.alice, project).await;
    for index in 0..600u32 {
        send_update(
            &mut bob,
            &envelope(&stage.bob, project, &index.to_be_bytes()),
        )
        .await;
        assert!(matches!(
            next_frame(&mut bob).await,
            Some(ServerFrame::Ack { .. }) | Some(ServerFrame::PresenceLeft { .. })
        ));
    }
    assert_eq!(alice.status().await, StatusCode::NOT_FOUND);
    let (again, frames) = open(&stage.server, &stage.alice, project, 0).await;
    assert!(again.is_some());
    assert_eq!(frames.len(), 601);
    assert!(matches!(
        frames.last(),
        Some(ServerFrame::Update { seq: 600, .. })
    ));
}

fn request(method: HttpMethod, path: &str, from: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .body(Body::empty())
        .expect("request");
    let address: SocketAddr = format!("{from}:40000").parse().expect("address");
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

#[tokio::test]
async fn opening_a_long_poll_is_rate_limited_like_the_socket() {
    let app = test_app().await;
    let router = build_router(app.state.clone());
    let path = format!("/api/v1/projects/{}/poll", SharedProjectId::new_v7());
    for attempt in 0..CONNECT_BURST {
        let refused = router
            .clone()
            .oneshot(request(HttpMethod::GET, &path, "203.0.113.7"))
            .await
            .expect("response");
        assert_eq!(
            refused.status(),
            HttpStatus::UNAUTHORIZED,
            "attempt {attempt}"
        );
    }
    let limited = router
        .clone()
        .oneshot(request(HttpMethod::GET, &path, "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(limited.status(), HttpStatus::TOO_MANY_REQUESTS);
    let socket = router
        .clone()
        .oneshot(request(HttpMethod::GET, "/ws", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(socket.status(), HttpStatus::TOO_MANY_REQUESTS);
    let sign_in = router
        .clone()
        .oneshot(request(HttpMethod::POST, "/auth/challenge", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(sign_in.status(), HttpStatus::OK);
    let other = router
        .clone()
        .oneshot(request(HttpMethod::GET, &path, "198.51.100.4"))
        .await
        .expect("response");
    assert_eq!(other.status(), HttpStatus::UNAUTHORIZED);
}

#[tokio::test]
async fn an_account_keeps_at_most_its_long_poll_allowance_and_the_oldest_gives_way() {
    let stage = stage().await;
    quick(&stage);
    stage.server.state().polls.set_account_cap(2);
    let mut projects = Vec::new();
    for title in ["One", "Two", "Three"] {
        projects.push(
            share_project(&stage.server, &stage.bob, title)
                .await
                .project_id,
        );
    }
    let oldest = opened(&stage.server, &stage.bob, projects[0]).await;
    let middle = opened(&stage.server, &stage.bob, projects[1]).await;
    let newest = opened(&stage.server, &stage.bob, projects[2]).await;
    assert_eq!(oldest.status().await, StatusCode::NOT_FOUND);
    assert_eq!(middle.status().await, StatusCode::OK);
    assert_eq!(newest.status().await, StatusCode::OK);
    assert_eq!(stage.server.state().polls.count(), 2);
}

fn config_with_hold(raw: Option<&str>) -> Result<ServerConfig, ConfigError> {
    let mut vars = BTreeMap::new();
    vars.insert(
        "OLEAFLY_PUBLIC_URL".to_owned(),
        "https://collab.test".to_owned(),
    );
    vars.insert(
        "OLEAFLY_DATA_DIR".to_owned(),
        std::env::temp_dir()
            .join("oleafly-server-test-data")
            .display()
            .to_string(),
    );
    if let Some(raw) = raw {
        vars.insert("OLEAFLY_POLL_HOLD_SECONDS".to_owned(), raw.to_owned());
    }
    ServerConfig::from_vars(&vars, &|path: &std::path::Path| {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            path.display().to_string(),
        ))
    })
}

#[tokio::test]
async fn the_long_poll_hold_comes_from_the_configuration() {
    let standard = test_app_with(config_with_hold(None).expect("valid")).await;
    assert_eq!(standard.state.polls.hold(), Duration::from_secs(25));
    let short = test_app_with(config_with_hold(Some("8")).expect("valid")).await;
    assert_eq!(short.state.polls.hold(), Duration::from_secs(8));
    for raw in ["0", "41", "soon"] {
        let refused = config_with_hold(Some(raw));
        assert!(
            matches!(&refused, Err(error) if error.variable == "OLEAFLY_POLL_HOLD_SECONDS"),
            "{raw} was accepted"
        );
    }
}
