use std::time::Duration;

use serde_json::{json, Value};

use super::super::SessionTuning;
use super::{eventually, project, tuning, Port, Rig, Tab, FILES, INTRO, MAIN};
use crate::live::{DocId, PublicId};
use crate::realtime::project::Role;
use crate::test_support::mock_overleaf::{MockPeer, Privilege};

fn quick() -> SessionTuning {
    SessionTuning {
        presence_with_peers: Duration::from_millis(300),
        presence_alone: Duration::from_secs(60),
        peer_reemit: Duration::from_millis(150),
        ..tuning()
    }
}

fn positions(rig: &Rig, public_id: &str) -> Vec<Value> {
    rig.mock
        .received("clientTracking.updatePosition")
        .into_iter()
        .filter(|received| received.public_id == public_id)
        .map(|received| received.args[0].clone())
        .collect()
}

fn move_to(peer: &mut MockPeer, doc: &DocId, column: u64) {
    peer.emit(
        "clientTracking.updatePosition",
        vec![json!({ "row": 0, "column": column, "doc_id": doc.0 })],
    );
}

fn sightings(port: &Port, id: &str) -> usize {
    port.seen()
        .peers
        .iter()
        .filter(|peer| peer.id.0 == id)
        .count()
}

#[tokio::test]
async fn update_position_sends_only_row_column_doc() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let _tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    live.presence(Some((main.clone(), 3)));
    let me = rig.connection_of("alice").unwrap();
    eventually("the position goes out", || !positions(&rig, &me).is_empty()).await;
    assert_eq!(
        positions(&rig, &me),
        vec![json!({ "row": 0, "column": 3, "doc_id": main.0 })]
    );
    assert_eq!(rig.connection_of("alice"), Some(me));
    live.stop().await;
}

#[tokio::test]
async fn position_updates_throttle_with_and_without_peers() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quick()).await;
    let main = rig.id(MAIN);
    let _tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let me = rig.connection_of("alice").unwrap();
    live.presence(Some((main.clone(), 1)));
    eventually("the first position goes out", || {
        positions(&rig, &me).len() == 1
    })
    .await;
    live.presence(Some((main.clone(), 2)));
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(positions(&rig, &me).len(), 1, "alone, a move waits");
    rig.mock.emit_to_room("clientTracking.refresh", &[]);
    eventually("asked again, the position goes out at once", || {
        positions(&rig, &me).len() == 2
    })
    .await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    move_to(&mut bob, &main, 0);
    eventually("bob is known", || sightings(&port, &bob.public_id) > 0).await;
    live.presence(Some((main.clone(), 4)));
    eventually("with a peer, a move goes out soon", || {
        positions(&rig, &me).len() == 3
    })
    .await;
    live.presence(Some((main.clone(), 5)));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(positions(&rig, &me).len(), 3, "still inside the window");
    eventually("the next window sends it", || {
        positions(&rig, &me).len() == 4
    })
    .await;
    assert_eq!(positions(&rig, &me)[3]["column"], json!(5));
    live.stop().await;
}

#[tokio::test]
async fn a_peer_on_an_unopened_doc_shows_in_the_tree() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let intro = rig.id(INTRO);
    let mut bob = rig.mock.peer("bob");
    bob.join(&intro.0);
    move_to(&mut bob, &intro, 2);
    eventually("bob shows on the unopened doc", || {
        port.seen()
            .peers
            .iter()
            .any(|peer| peer.id.0 == bob.public_id && peer.doc.as_ref() == Some(&intro))
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn our_own_position_is_not_a_peer() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let _tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    live.presence(Some((main.clone(), 2)));
    let me = rig.connection_of("alice").unwrap();
    eventually("the position goes out", || !positions(&rig, &me).is_empty()).await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    move_to(&mut bob, &main, 1);
    eventually("bob is seen", || sightings(&port, &bob.public_id) > 0).await;
    assert_eq!(sightings(&port, &me), 0);
    live.stop().await;
}

#[tokio::test]
async fn own_other_client_is_labelled_you() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quick()).await;
    let main = rig.id(MAIN);
    let mut browser = rig.mock.peer("alice");
    browser.join(&main.0);
    move_to(&mut browser, &main, 4);
    eventually("the other window shows as a peer", || {
        sightings(&port, &browser.public_id) > 0
    })
    .await;
    let _tab = Tab::open(&live, MAIN);
    eventually("its caret is placed once the doc's text is here", || {
        port.seen()
            .peers
            .iter()
            .any(|peer| peer.id.0 == browser.public_id && peer.offset == Some(4))
    })
    .await;
    let alice = rig.user_id("alice");
    let other = port
        .seen()
        .peers
        .iter()
        .rev()
        .find(|peer| peer.id.0 == browser.public_id)
        .cloned()
        .unwrap();
    assert_eq!(other.user_id.as_deref(), Some(alice.as_str()));
    assert_eq!(other.offset, Some(4));
    live.stop().await;
}

#[tokio::test]
async fn peers_already_here_come_in_on_join() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    move_to(&mut bob, &main, 3);
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    eventually("bob, already here, is listed", || {
        port.seen().peers.iter().any(|peer| {
            peer.id.0 == bob.public_id
                && peer.doc.as_ref() == Some(&main)
                && peer.name.as_deref() == Some("Bob Tester")
        })
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn peers_are_re_emitted_until_disconnected() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quick()).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    move_to(&mut bob, &main, 1);
    let id = bob.public_id.clone();
    eventually("bob is re-emitted while he reads", || {
        sightings(&port, &id) >= 4
    })
    .await;
    let first = port
        .seen()
        .peers
        .iter()
        .find(|peer| peer.id.0 == id)
        .cloned()
        .unwrap();
    assert!(port
        .seen()
        .peers
        .iter()
        .filter(|peer| peer.id.0 == id)
        .all(|peer| *peer == first));
    bob.drop_connection();
    eventually("bob leaves", || {
        port.seen().left.contains(&PublicId(id.clone()))
    })
    .await;
    let after = sightings(&port, &id);
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(sightings(&port, &id), after);
    live.stop().await;
}

#[tokio::test]
async fn peers_leave_when_the_session_goes_offline() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    move_to(&mut bob, &main, 1);
    let id = PublicId(bob.public_id.clone());
    eventually("bob is seen", || sightings(&port, &id.0) > 0).await;
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("bob is cleared while offline", || {
        port.seen().left.contains(&id)
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn membership_change_refreshes_roles() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let vera = rig.user_id("vera");
    let role_of_vera = || {
        live.members()
            .into_iter()
            .find(|member| member.id == vera)
            .map(|member| member.role)
    };
    assert_eq!(role_of_vera(), Some(Role::Viewer));
    rig.mock
        .set_privilege("vera", Some(Privilege::ReadAndWrite));
    eventually("vera's new role is known", || {
        role_of_vera() == Some(Role::Editor)
    })
    .await;
    assert!(port.seen().members_changed > 0);
    live.stop().await;
}
