mod people;

use loro::{ExportMode, LoroDoc};
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::{ProjectRole, ProjectSummary};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_collab_protocol::snapshots::ProjectPeer;
use oleafly_server::test_support::seed_member;
use people::{
    call, connect, first_snapshot, grant, next_frame, raw_envelope, read, send_update,
    share_project, signed_by, stage, subscribe, Socket, Stage, SNAPSHOT_PEER,
};
use reqwest::{Method, StatusCode};

const ALICE_PEER: u64 = 1_001;

async fn shared_with_alice(stage: &Stage) -> SharedProjectId {
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    assert_eq!(
        grant(
            &stage.server,
            &stage.bob,
            project,
            &stage.alice,
            ProjectRole::Editor
        )
        .await
        .status(),
        StatusCode::OK
    );
    project
}

fn base() -> LoroDoc {
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    doc
}

fn typed(doc: &LoroDoc, peer: u64, text: &str) -> Vec<u8> {
    let before = doc.oplog_vv();
    doc.set_peer_id(peer).expect("peer");
    let field = doc.get_text("text");
    field.insert(field.len_unicode(), text).expect("insert");
    doc.commit();
    doc.export(ExportMode::updates(&before)).expect("update")
}

async fn sent(socket: &mut Socket) -> ServerFrame {
    loop {
        match next_frame(socket).await.expect("a reply") {
            ServerFrame::Update { .. } | ServerFrame::Presence { .. } => {}
            reply => return reply,
        }
    }
}

async fn head(stage: &Stage, project: SharedProjectId) -> u64 {
    let summary: ProjectSummary = read(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{project}"),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await;
    summary.head_seq
}

async fn opened(stage: &Stage, project: SharedProjectId) -> (Socket, Socket) {
    let mut bob = connect(&stage.server, &stage.bob).await;
    let mut alice = connect(&stage.server, &stage.alice).await;
    assert!(matches!(
        subscribe(&mut bob, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    assert!(matches!(
        subscribe(&mut alice, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    (bob, alice)
}

#[tokio::test]
async fn a_change_under_a_peer_another_device_wrote_with_is_refused() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let (mut bob, mut alice) = opened(&stage, project).await;
    let alice_doc = base();
    let honest = typed(&alice_doc, ALICE_PEER, " from Alice");
    send_update(
        &mut alice,
        &signed_by(&stage.alice, &stage.alice.device, project, &honest),
    )
    .await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Ack { seq: 1, .. }
    ));
    let mallory_doc = base();
    mallory_doc.import(&honest).expect("import");
    let forged = typed(&mallory_doc, ALICE_PEER, " forged");
    send_update(
        &mut bob,
        &signed_by(&stage.bob, &stage.bob.device, project, &forged),
    )
    .await;
    assert!(
        matches!(
            sent(&mut bob).await,
            ServerFrame::Error {
                code: FrameErrorCode::Unauthorized,
                ..
            }
        ),
        "a change under Alice's peer from Bob's device must be refused"
    );
    assert_eq!(head(&stage, project).await, 1);
    let more = typed(&alice_doc, ALICE_PEER, " and more");
    send_update(
        &mut alice,
        &signed_by(&stage.alice, &stage.alice.device, project, &more),
    )
    .await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Ack { seq: 2, .. }
    ));
}

#[tokio::test]
async fn a_relay_of_changes_the_server_already_holds_is_accepted() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let (mut bob, mut alice) = opened(&stage, project).await;
    let alice_doc = base();
    let honest = typed(&alice_doc, ALICE_PEER, " from Alice");
    send_update(
        &mut alice,
        &signed_by(&stage.alice, &stage.alice.device, project, &honest),
    )
    .await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Ack { seq: 1, .. }
    ));
    let bob_doc = base();
    let since = bob_doc.oplog_vv();
    bob_doc.import(&honest).expect("import");
    typed(&bob_doc, 2_002, " from Bob");
    let relayed = bob_doc.export(ExportMode::updates(&since)).expect("relay");
    send_update(
        &mut bob,
        &signed_by(&stage.bob, &stage.bob.device, project, &relayed),
    )
    .await;
    assert!(matches!(
        sent(&mut bob).await,
        ServerFrame::Ack { seq: 2, .. }
    ));
}

#[tokio::test]
async fn the_first_snapshot_binds_its_peers_to_the_owners_device() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let (_bob, mut alice) = opened(&stage, project).await;
    let doc = base();
    let forged = typed(&doc, SNAPSHOT_PEER, " as the owner");
    send_update(
        &mut alice,
        &signed_by(&stage.alice, &stage.alice.device, project, &forged),
    )
    .await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Error {
            code: FrameErrorCode::Unauthorized,
            ..
        }
    ));
    assert_eq!(head(&stage, project).await, 0);
}

#[tokio::test]
async fn a_change_that_is_not_a_loro_update_is_refused() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let (_bob, mut alice) = opened(&stage, project).await;
    send_update(&mut alice, &raw_envelope(&stage.alice, project, b"hello")).await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            ..
        }
    ));
    let snapshot = raw_envelope(&stage.alice, project, &first_snapshot());
    send_update(&mut alice, &snapshot).await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            ..
        }
    ));
    assert_eq!(head(&stage, project).await, 0);
}

#[tokio::test]
async fn members_read_which_device_wrote_with_each_peer() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let (_bob, mut alice) = opened(&stage, project).await;
    let alice_doc = base();
    let honest = typed(&alice_doc, ALICE_PEER, " from Alice");
    send_update(
        &mut alice,
        &signed_by(&stage.alice, &stage.alice.device, project, &honest),
    )
    .await;
    assert!(matches!(sent(&mut alice).await, ServerFrame::Ack { .. }));
    let path = format!("/api/v1/projects/{project}/peers");
    let mut listed: Vec<ProjectPeer> =
        read(call(&stage.server, Method::GET, &path, stage.alice.token(), None).await).await;
    listed.sort_by_key(|peer| peer.peer);
    assert_eq!(
        listed,
        vec![
            ProjectPeer {
                peer: SNAPSHOT_PEER,
                device_id: stage.bob.tokens.device_id,
                account_id: stage.bob.tokens.account_id,
            },
            ProjectPeer {
                peer: ALICE_PEER,
                device_id: stage.alice.tokens.device_id,
                account_id: stage.alice.tokens.account_id,
            },
        ]
    );
    let outsider = seed_member(stage.server.app(), ServerRole::Member).await;
    assert_eq!(
        call(
            &stage.server,
            Method::GET,
            &path,
            &outsider.access_token,
            None
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_change_that_builds_on_changes_the_server_never_stored_is_refused() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let (_bob, mut alice) = opened(&stage, project).await;
    let doc = base();
    typed(&doc, ALICE_PEER, " never sent");
    let after_gap = typed(&doc, ALICE_PEER, " sent");
    send_update(
        &mut alice,
        &signed_by(&stage.alice, &stage.alice.device, project, &after_gap),
    )
    .await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            ..
        }
    ));
    let other = base();
    typed(&other, 3_003, " unseen");
    let builds_on = typed(&other, 4_004, " on top");
    send_update(
        &mut alice,
        &signed_by(&stage.alice, &stage.alice.device, project, &builds_on),
    )
    .await;
    assert!(matches!(
        sent(&mut alice).await,
        ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            ..
        }
    ));
    assert_eq!(head(&stage, project).await, 0);
}
