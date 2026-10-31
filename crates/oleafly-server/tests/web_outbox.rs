#![cfg(feature = "web")]

mod people;
mod web_support;

use std::time::Duration;

use oleafly_collab_protocol::projects::ProjectRole;
use reqwest::StatusCode;
use serde_json::{json, Value};
use web_support::{
    browser_sign_in, insert_at, next_web, open_text, send_web, share_doc_project, until,
    until_where, utf16, web_socket, web_stage, Browser, Desktop, Shared, WebSocket, DESKTOP_PEER,
    MAIN_TEXT,
};

const QUIET: Duration = Duration::from_millis(400);

struct Room {
    stage: people::Stage,
    shared: Shared,
    alice: Browser,
    bob: Browser,
}

async fn room(alice_role: ProjectRole) -> Room {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, alice_role).await;
    let alice = browser_sign_in(&stage.server, "github2", "/web/").await;
    let bob = browser_sign_in(&stage.server, "github", "/web/").await;
    Room {
        stage,
        shared,
        alice,
        bob,
    }
}

async fn joined(room: &Room, browser: &Browser) -> (WebSocket, u64) {
    let mut socket = web_socket(&room.stage.server, browser, room.shared.project).await;
    until(&mut socket, "hello").await;
    let opened = open_text(&mut socket, &room.shared.main, None).await;
    (socket, opened["rev"].as_u64().expect("a revision"))
}

async fn type_at(socket: &mut WebSocket, file: &str, rev: u64, op: Value, id: Option<&str>) {
    let mut frame = json!({ "t": "change", "fileId": file, "rev": rev, "op": op });
    if let Some(id) = id {
        frame["id"] = json!(id);
    }
    send_web(socket, frame).await;
}

async fn silent(socket: &mut WebSocket, kind: &str) -> bool {
    tokio::time::timeout(QUIET, until(socket, kind))
        .await
        .is_err()
}

async fn frames_until(socket: &mut WebSocket, kind: &str) -> Vec<Value> {
    let mut seen = Vec::new();
    loop {
        let frame = next_web(socket).await.expect("the socket stays open");
        let done = frame["t"] == kind;
        seen.push(frame);
        if done {
            return seen;
        }
    }
}

fn kinds(frames: &[Value]) -> Vec<&str> {
    frames
        .iter()
        .filter_map(|frame| frame["t"].as_str())
        .collect()
}

async fn text_now(room: &Room) -> String {
    let (mut socket, _) = joined(room, &room.bob).await;
    let opened = open_text(&mut socket, &room.shared.main, None).await;
    opened["text"].as_str().expect("a text").to_string()
}

#[tokio::test]
async fn another_sessions_edit_is_not_blocked_behind_a_slow_role_check() {
    let room = room(ProjectRole::Reviewer).await;
    let gate = room.stage.server.state().comment_guard.hold_role_checks();
    let (mut alice, alice_rev) = joined(&room, &room.alice).await;
    let (mut bob, bob_rev) = joined(&room, &room.bob).await;
    let (mut watcher, _) = joined(&room, &room.bob).await;
    let length = utf16(MAIN_TEXT);
    type_at(
        &mut alice,
        &room.shared.main,
        alice_rev,
        insert_at(0, "A", length),
        None,
    )
    .await;
    type_at(
        &mut bob,
        &room.shared.main,
        bob_rev,
        insert_at(length, "B", length),
        None,
    )
    .await;
    let seen = tokio::time::timeout(
        Duration::from_secs(3),
        until_where(&mut watcher, |frame| {
            frame["t"] == "remote" && frame["op"].to_string().contains("\"B\"")
        }),
    )
    .await
    .expect("bob's edit reached another session while alice's change was still being checked");
    assert_eq!(seen["fileId"], room.shared.main.as_str());
    assert!(
        silent(&mut bob, "ack").await,
        "bob's ack waits for alice's store"
    );
    assert!(
        silent(&mut alice, "ack").await,
        "alice's ack waits for her store"
    );
    gate.add_permits(16);
    until(&mut alice, "ack").await;
    let acked = until(&mut bob, "ack").await;
    assert_eq!(acked["length"], length + 2);
    let text = text_now(&room).await;
    assert_eq!(text, format!("A{MAIN_TEXT}B"));
}

#[tokio::test]
async fn a_refused_change_drops_the_changes_queued_after_it_and_reloads() {
    let room = room(ProjectRole::Reviewer).await;
    let gate = room.stage.server.state().comment_guard.hold_role_checks();
    let (mut alice, alice_rev) = joined(&room, &room.alice).await;
    let (mut bob, bob_rev) = joined(&room, &room.bob).await;
    let length = utf16(MAIN_TEXT);
    type_at(
        &mut alice,
        &room.shared.main,
        alice_rev,
        insert_at(0, "A", length),
        None,
    )
    .await;
    type_at(
        &mut bob,
        &room.shared.main,
        bob_rev,
        insert_at(length, "B", length),
        None,
    )
    .await;
    assert!(silent(&mut bob, "ack").await);
    let demoted = people::grant(
        &room.stage.server,
        &room.stage.bob,
        room.shared.project,
        &room.stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(demoted.status(), StatusCode::OK);
    gate.add_permits(16);
    let before_reset = frames_until(&mut bob, "reset").await;
    assert!(!kinds(&before_reset).contains(&"ack"), "{before_reset:?}");
    let reset = before_reset.last().cloned().unwrap_or_default();
    assert_eq!(reset["text"], MAIN_TEXT);
    let refused = until(&mut alice, "error").await;
    assert_eq!(refused["code"], "forbidden");
    let rev = reset["rev"].as_u64().expect("a revision");
    type_at(
        &mut bob,
        &room.shared.main,
        rev,
        insert_at(length, "B", length),
        None,
    )
    .await;
    until(&mut bob, "ack").await;
    assert_eq!(text_now(&room).await, format!("{MAIN_TEXT}B"));
}

#[tokio::test]
async fn a_reload_asked_for_during_a_store_waits_for_the_store_and_its_ack() {
    let room = room(ProjectRole::Reviewer).await;
    let state = room.stage.server.state();
    let gate = state.comment_guard.hold_role_checks();
    let (mut alice, alice_rev) = joined(&room, &room.alice).await;
    let (mut bob, bob_rev) = joined(&room, &room.bob).await;
    let length = utf16(MAIN_TEXT);
    type_at(
        &mut alice,
        &room.shared.main,
        alice_rev,
        insert_at(0, "A", length),
        None,
    )
    .await;
    until(&mut bob, "remote").await;
    let web_room = state.web.live(room.shared.project).expect("a live room");
    tokio::time::timeout(Duration::from_secs(3), web_room.ask_reload(state))
        .await
        .expect("asking for a reload does not wait for the store");
    type_at(
        &mut bob,
        &room.shared.main,
        bob_rev,
        insert_at(length, "B", length),
        None,
    )
    .await;
    assert!(
        silent(&mut alice, "reset").await,
        "no reset while the store runs"
    );
    gate.add_permits(16);
    let alice_frames = frames_until(&mut alice, "reset").await;
    let order = kinds(&alice_frames);
    let ack = order.iter().position(|kind| *kind == "ack");
    assert!(
        ack.is_some_and(|ack| ack < order.len() - 1),
        "alice's ack comes before the reload's reset: {order:?}"
    );
    let bob_frames = frames_until(&mut bob, "reset").await;
    assert!(!kinds(&bob_frames).contains(&"ack"), "{bob_frames:?}");
    let reset = bob_frames.last().cloned().unwrap_or_default();
    let text = reset["text"].as_str().expect("a text").to_string();
    assert_eq!(text, format!("A{MAIN_TEXT}"));
    let rev = reset["rev"].as_u64().expect("a revision");
    type_at(
        &mut bob,
        &room.shared.main,
        rev,
        insert_at(length + 1, "B", length + 1),
        None,
    )
    .await;
    until(&mut bob, "ack").await;
    assert_eq!(text_now(&room).await, format!("A{MAIN_TEXT}B"));
}

#[tokio::test]
async fn a_resume_for_a_change_still_queued_waits_for_its_store() {
    let room = room(ProjectRole::Reviewer).await;
    let gate = room.stage.server.state().comment_guard.hold_role_checks();
    let (mut alice, alice_rev) = joined(&room, &room.alice).await;
    let length = utf16(MAIN_TEXT);
    type_at(
        &mut alice,
        &room.shared.main,
        alice_rev,
        insert_at(0, "A", length),
        Some("tab:1"),
    )
    .await;
    let mut again = web_socket(&room.stage.server, &room.alice, room.shared.project).await;
    until(&mut again, "hello").await;
    send_web(
        &mut again,
        json!({ "t": "open", "fileId": room.shared.main, "resume": "tab:1" }),
    )
    .await;
    assert!(
        silent(&mut again, "opened").await,
        "the answer waits for the store"
    );
    gate.add_permits(16);
    let opened = until(&mut again, "opened").await;
    assert_eq!(opened["resumed"], true);
    assert_eq!(opened["text"], format!("A{MAIN_TEXT}"));
}

#[tokio::test]
async fn a_change_queued_when_its_socket_closes_is_still_stored() {
    let room = room(ProjectRole::Reviewer).await;
    let gate = room.stage.server.state().comment_guard.hold_role_checks();
    let mut desktop = Desktop::open(&room.stage, &room.stage.bob, &room.shared, DESKTOP_PEER).await;
    let (mut alice, alice_rev) = joined(&room, &room.alice).await;
    let (mut bob, _) = joined(&room, &room.bob).await;
    let length = utf16(MAIN_TEXT);
    type_at(
        &mut alice,
        &room.shared.main,
        alice_rev,
        insert_at(0, "A", length),
        None,
    )
    .await;
    until(&mut bob, "remote").await;
    drop(alice);
    tokio::time::sleep(QUIET).await;
    gate.add_permits(16);
    desktop.hear_update().await;
    assert_eq!(desktop.text(&room.shared.main), format!("A{MAIN_TEXT}"));
}

async fn typist(
    mut socket: WebSocket,
    file: String,
    marker: &'static str,
    times: usize,
) -> WebSocket {
    let opened = open_text(&mut socket, &file, None).await;
    let mut rev = opened["rev"].as_u64().expect("a revision");
    let mut length = utf16(opened["text"].as_str().expect("a text"));
    for _ in 0..times {
        loop {
            type_at(&mut socket, &file, rev, json!([marker, length]), None).await;
            let answer = until_where(&mut socket, |frame| {
                frame["t"] == "ack" || frame["t"] == "reset"
            })
            .await;
            rev = answer["rev"].as_u64().expect("a revision");
            if answer["t"] == "ack" {
                length = answer["length"].as_u64().expect("a length") as usize;
                break;
            }
            length = utf16(answer["text"].as_str().expect("a text"));
        }
    }
    socket
}

#[tokio::test]
async fn many_sessions_typing_at_once_each_land_once_in_order() {
    let room = room(ProjectRole::Editor).await;
    let times = 8;
    let markers = ["1", "2", "3", "4"];
    let mut sockets = Vec::new();
    for (index, _) in markers.iter().enumerate() {
        let browser = if index % 2 == 0 {
            &room.alice
        } else {
            &room.bob
        };
        let mut socket = web_socket(&room.stage.server, browser, room.shared.project).await;
        until(&mut socket, "hello").await;
        sockets.push(socket);
    }
    let file = room.shared.main.clone();
    let mut sockets = sockets.into_iter();
    let (first, second, third, fourth) = (
        sockets.next().expect("a socket"),
        sockets.next().expect("a socket"),
        sockets.next().expect("a socket"),
        sockets.next().expect("a socket"),
    );
    let _typed = tokio::join!(
        typist(first, file.clone(), markers[0], times),
        typist(second, file.clone(), markers[1], times),
        typist(third, file.clone(), markers[2], times),
        typist(fourth, file.clone(), markers[3], times),
    );
    let text = text_now(&room).await;
    assert_eq!(utf16(&text), utf16(MAIN_TEXT) + markers.len() * times);
    for marker in markers {
        assert_eq!(text.matches(marker).count(), times, "{marker} in {text:?}");
    }
    assert!(text.ends_with(MAIN_TEXT), "{text:?}");
}

#[tokio::test]
async fn an_authors_ack_comes_before_every_later_edit_on_its_channel() {
    let room = room(ProjectRole::Reviewer).await;
    let gate = room.stage.server.state().comment_guard.hold_role_checks();
    let (mut alice, alice_rev) = joined(&room, &room.alice).await;
    let (mut bob, bob_rev) = joined(&room, &room.bob).await;
    let length = utf16(MAIN_TEXT);
    type_at(
        &mut alice,
        &room.shared.main,
        alice_rev,
        insert_at(0, "A", length),
        None,
    )
    .await;
    until(&mut bob, "remote").await;
    type_at(
        &mut bob,
        &room.shared.main,
        bob_rev,
        insert_at(length, "B", length),
        None,
    )
    .await;
    assert!(
        silent(&mut alice, "remote").await,
        "bob's edit waits behind alice's ack"
    );
    gate.add_permits(16);
    let frames = frames_until(&mut alice, "remote").await;
    let order = kinds(&frames);
    let ack = order.iter().position(|kind| *kind == "ack");
    let suggestions = order.iter().position(|kind| *kind == "suggestions");
    assert!(ack.is_some(), "{order:?}");
    assert!(ack < suggestions, "{order:?}");
    assert_eq!(
        frames.last().map(|frame| frame["rev"].clone()),
        Some(json!(alice_rev + 2))
    );
    let acked = &frames[ack.unwrap_or_default()];
    assert_eq!(acked["rev"], alice_rev + 1);
}
