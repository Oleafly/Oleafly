mod people;

use oleafly_collab_protocol::admin::{MemberPatch, MemberStatus};
use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_server::test_support::refresh_session;
use people::{call, connect, next_frame, stage, Person, Stage};
use reqwest::{Method, StatusCode};

async fn suspend(stage: &Stage, who: &Person) {
    let patch = MemberPatch {
        role: None,
        status: Some(MemberStatus::Suspended),
    };
    let response = call(
        &stage.server,
        Method::PATCH,
        &format!("/api/v1/admin/members/{}", who.tokens.account_id),
        stage.bob.token(),
        Some(serde_json::to_value(patch).expect("json")),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

async fn remove_from_server(stage: &Stage, who: &Person) {
    let response = call(
        &stage.server,
        Method::DELETE,
        &format!("/api/v1/admin/members/{}", who.tokens.account_id),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

async fn refresh(stage: &Stage, who: &Person) -> Result<(), String> {
    refresh_session(
        &stage.server,
        &who.device,
        who.tokens.device_id,
        &who.tokens.refresh_token,
    )
    .await
    .map(|_| ())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_suspended_member_is_told_their_account_is_suspended_when_they_refresh() {
    let stage = stage().await;
    suspend(&stage, &stage.alice).await;
    assert_eq!(
        refresh(&stage, &stage.alice).await.err().as_deref(),
        Some("account_suspended")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_removed_from_the_server_is_told_their_access_ended_when_they_refresh() {
    let stage = stage().await;
    remove_from_server(&stage, &stage.alice).await;
    assert_eq!(
        refresh(&stage, &stage.alice).await.err().as_deref(),
        Some("access_ended")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refresh_without_the_device_key_never_learns_why() {
    let stage = stage().await;
    suspend(&stage, &stage.alice).await;
    let stolen = refresh_session(
        &stage.server,
        &stage.bob.device,
        stage.alice.tokens.device_id,
        &stage.alice.tokens.refresh_token,
    )
    .await;
    assert_eq!(stolen.err().as_deref(), Some("revoked"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_connected_member_hears_that_their_account_was_suspended() {
    let stage = stage().await;
    let mut socket = connect(&stage.server, &stage.alice).await;
    suspend(&stage, &stage.alice).await;
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::SessionRevoked {
            reason: Some(SessionEndReason::AccountSuspended)
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_connected_member_hears_that_their_access_to_the_server_ended() {
    let stage = stage().await;
    let mut socket = connect(&stage.server, &stage.alice).await;
    remove_from_server(&stage, &stage.alice).await;
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::SessionRevoked {
            reason: Some(SessionEndReason::AccessEnded)
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reactivated_member_signs_in_again_and_refreshes_normally() {
    let stage = stage().await;
    suspend(&stage, &stage.alice).await;
    let patch = MemberPatch {
        role: None,
        status: Some(MemberStatus::Active),
    };
    let response = call(
        &stage.server,
        Method::PATCH,
        &format!("/api/v1/admin/members/{}", stage.alice.tokens.account_id),
        stage.bob.token(),
        Some(serde_json::to_value(patch).expect("json")),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        refresh(&stage, &stage.alice).await.err().as_deref(),
        Some("revoked")
    );
}
