mod people;

use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{ProjectDevice, ProjectMember, ProjectRole};
use people::{
    call, connect, envelope, grant, next_frame, read, send_update, share_project, stage, subscribe,
    Person,
};
use reqwest::{Method, StatusCode};
use serde_json::Value;

fn devices_path(project: SharedProjectId) -> String {
    format!("/api/v1/projects/{project}/devices")
}

fn entry(person: &Person) -> (DeviceId, AccountId, String) {
    (
        person.tokens.device_id,
        person.tokens.account_id,
        person.device.public_key_b64().to_owned(),
    )
}

fn entries(devices: &[ProjectDevice]) -> Vec<(DeviceId, AccountId, String)> {
    let mut found: Vec<_> = devices
        .iter()
        .map(|device| {
            (
                device.device_id,
                device.account_id,
                device.public_key.clone(),
            )
        })
        .collect();
    found.sort();
    found
}

fn sorted(mut list: Vec<(DeviceId, AccountId, String)>) -> Vec<(DeviceId, AccountId, String)> {
    list.sort();
    list
}

#[tokio::test]
async fn members_including_viewers_see_every_device_and_others_are_refused_like_elsewhere() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let path = devices_path(project);
    let outsider = call(server, Method::GET, &path, alice.token(), None).await;
    assert_eq!(outsider.status(), StatusCode::NOT_FOUND);
    let refusal: Value = outsider.json().await.expect("json refusal");
    let members = format!("/api/v1/projects/{project}/members");
    let elsewhere: Value = call(server, Method::GET, &members, alice.token(), None)
        .await
        .json()
        .await
        .expect("json refusal");
    assert_eq!(refusal, elsewhere);
    let _: ProjectMember =
        read(grant(server, bob, project, alice, ProjectRole::Viewer).await).await;
    let listed: Vec<ProjectDevice> =
        read(call(server, Method::GET, &path, alice.token(), None).await).await;
    assert_eq!(entries(&listed), sorted(vec![entry(bob), entry(alice)]));
    assert!(listed.iter().all(|device| device.added_at > 0));
    let owner_view: Vec<ProjectDevice> =
        read(call(server, Method::GET, &path, bob.token(), None).await).await;
    assert_eq!(entries(&owner_view), entries(&listed));
}

#[tokio::test]
async fn a_removed_member_is_refused_but_their_signing_device_stays_listed() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let _: ProjectMember =
        read(grant(server, bob, project, alice, ProjectRole::Editor).await).await;
    let mut socket = connect(server, alice).await;
    subscribe(&mut socket, project, 0).await;
    send_update(&mut socket, &envelope(alice, project, b"hello")).await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Ack { .. })
    ));
    let removed = format!(
        "/api/v1/projects/{project}/members/{}",
        alice.tokens.account_id
    );
    assert_eq!(
        call(server, Method::DELETE, &removed, bob.token(), None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let path = devices_path(project);
    assert_eq!(
        call(server, Method::GET, &path, alice.token(), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let listed: Vec<ProjectDevice> =
        read(call(server, Method::GET, &path, bob.token(), None).await).await;
    assert_eq!(entries(&listed), sorted(vec![entry(bob), entry(alice)]));
}

#[tokio::test]
async fn updates_name_the_account_that_signed_them_live_and_from_the_backlog() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let _: ProjectMember =
        read(grant(server, bob, project, alice, ProjectRole::Editor).await).await;
    let mut bob_socket = connect(server, bob).await;
    let mut alice_socket = connect(server, alice).await;
    subscribe(&mut bob_socket, project, 0).await;
    subscribe(&mut alice_socket, project, 0).await;
    let change = envelope(bob, project, b"one");
    send_update(&mut bob_socket, &change).await;
    assert!(matches!(
        next_frame(&mut bob_socket).await,
        Some(ServerFrame::Ack { .. })
    ));
    let expected = ServerFrame::Update {
        project_id: project,
        seq: 1,
        account_id: Some(bob.tokens.account_id),
        envelope: change,
    };
    assert_eq!(next_frame(&mut alice_socket).await, Some(expected.clone()));
    let mut late = connect(server, alice).await;
    assert!(matches!(
        subscribe(&mut late, project, 0).await,
        ServerFrame::Subscribed { head_seq: 1, .. }
    ));
    assert_eq!(next_frame(&mut late).await, Some(expected));
}
