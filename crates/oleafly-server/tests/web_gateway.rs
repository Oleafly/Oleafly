#![cfg(feature = "web")]

mod people;
mod web_support;

use oleafly_collab::ot::TextOperation;
use oleafly_collab_protocol::frames::{ClientFrame, ServerFrame};
use oleafly_collab_protocol::outputs::MAIN_FILE_HEADER;
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use oleafly_server::snapshots::Budget;
use people::{call, grant, send_frame};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use web_support::{
    browser_sign_in, ends, insert_at, next_web, open_socket, send_web, share_doc_project, until,
    until_where, utf16, web_socket, web_stage, Desktop, Shared, WebSocket, DESKTOP_PEER, MAIN_TEXT,
};

async fn opened(socket: &mut WebSocket, file: &str) -> u64 {
    until(socket, "hello").await;
    send_web(socket, json!({ "t": "open", "fileId": file })).await;
    let opened = until(socket, "opened").await;
    assert_eq!(opened["text"], MAIN_TEXT);
    opened["rev"].as_u64().expect("a revision")
}

async fn act(socket: &mut WebSocket, mut frame: Value, req: &str) -> (Vec<Value>, Value) {
    frame["reqId"] = Value::String(req.to_string());
    send_web(socket, frame).await;
    let mut before = Vec::new();
    loop {
        let next = next_web(socket).await.expect("an answer");
        if next["reqId"] == req {
            return (before, next);
        }
        before.push(next);
    }
}

fn last_threads(frames: &[Value]) -> Vec<Value> {
    frames
        .iter()
        .rev()
        .find(|frame| frame["t"] == "threads")
        .and_then(|frame| frame["threads"].as_array().cloned())
        .expect("a threads frame")
}

async fn alice_in(role: ProjectRole) -> (people::Stage, Shared, WebSocket, web_support::Browser) {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, role).await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let socket = web_socket(&stage.server, &browser, shared.project).await;
    (stage, shared, socket, browser)
}

#[tokio::test]
async fn a_socket_from_another_origin_or_without_a_session_is_refused() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Editor).await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let status = |error: tokio_tungstenite::tungstenite::Error| match error {
        tokio_tungstenite::tungstenite::Error::Http(response) => response.status().as_u16(),
        other => panic!("{other:?}"),
    };
    let elsewhere = open_socket(
        &stage.server,
        &browser.jar,
        shared.project,
        Some("https://evil.example"),
    )
    .await
    .expect_err("another origin is refused");
    assert_eq!(status(elsewhere), 403);
    let no_origin = open_socket(&stage.server, &browser.jar, shared.project, None)
        .await
        .expect_err("a socket without an origin is refused");
    assert_eq!(status(no_origin), 403);
    let anonymous = open_socket(
        &stage.server,
        &browser.jar.without("oleafly_web"),
        shared.project,
        Some(&stage.server.url()),
    )
    .await
    .expect_err("a socket without a session is refused");
    assert_eq!(status(anonymous), 401);
}

#[tokio::test]
async fn the_hello_names_the_role_features_files_and_people_then_chat_output_and_presence() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Editor).await;
    let hello = next_web(&mut socket).await.expect("hello");
    assert_eq!(hello["t"], "hello");
    assert_eq!(hello["role"], "editor");
    assert_eq!(
        hello["features"],
        json!({ "comments": true, "suggestions": true, "chat": true })
    );
    let files = hello["files"].as_array().expect("files");
    assert!(files
        .iter()
        .any(|file| file["fileId"] == shared.main.as_str() && file["path"] == "main.tex"));
    assert!(files
        .iter()
        .any(|file| file["path"] == "figures/plot.png" && file["hash"] == "a".repeat(64)));
    let names: Vec<&str> = hello["members"]
        .as_array()
        .expect("members")
        .iter()
        .filter_map(|member| member["displayName"].as_str())
        .collect();
    assert!(
        names.contains(&"Bob Smith") && names.contains(&"Alice Chen"),
        "{names:?}"
    );
    assert_eq!(
        hello["compile"],
        json!({ "main_doc": shared.main, "engine": "latex" })
    );
    assert_eq!(next_web(&mut socket).await.expect("chat")["t"], "chat");
    let output = next_web(&mut socket).await.expect("output");
    assert_eq!(output, json!({ "t": "output", "items": [] }));
    let presence = next_web(&mut socket).await.expect("presence");
    assert_eq!(presence, json!({ "t": "presence", "peers": [] }));
    drop(stage);
}

#[tokio::test]
async fn a_browser_edit_is_acknowledged_with_its_length_and_reaches_a_desktop() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Editor).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "Hi ", length) }),
    )
    .await;
    let ack = until(&mut socket, "ack").await;
    assert_eq!(ack["fileId"], shared.main.as_str());
    assert_eq!(ack["rev"], rev + 1);
    assert_eq!(ack["length"], length + 3);
    let heard = desktop
        .hear_frame(|frame| matches!(frame, ServerFrame::Update { .. }))
        .await;
    let ServerFrame::Update { account_id, .. } = heard else {
        unreachable!()
    };
    assert_eq!(account_id, Some(stage.alice.tokens.account_id));
    assert_eq!(desktop.text(&shared.main), format!("Hi {MAIN_TEXT}"));
}

#[tokio::test]
async fn a_desktop_edit_reaches_the_open_browser_as_a_remote_change() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Editor).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    assert!(matches!(
        desktop.type_at(&stage.bob, &shared.main, 5, ",").await,
        ServerFrame::Ack { .. }
    ));
    let remote = until(&mut socket, "remote").await;
    assert_eq!(remote["fileId"], shared.main.as_str());
    assert_eq!(remote["rev"], rev + 1);
    assert_eq!(remote["op"], json!([5, ",", length - 5]));
    assert_eq!(remote["length"], length + 1);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(length, "!", length) }),
    )
    .await;
    let ack = until(&mut socket, "ack").await;
    assert_eq!(ack["rev"], rev + 2);
    assert_eq!(ack["length"], length + 2);
    desktop.hear_update().await;
    assert_eq!(desktop.text(&shared.main), "Hello, world\n!");
}

#[tokio::test]
async fn two_browsers_see_each_others_typing() {
    let (stage, shared, mut alice, _alice_browser) = alice_in(ProjectRole::Editor).await;
    let bob_browser = browser_sign_in(&stage.server, "github", "/web/").await;
    let mut bob = web_socket(&stage.server, &bob_browser, shared.project).await;
    let alice_rev = opened(&mut alice, &shared.main).await;
    let bob_rev = opened(&mut bob, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut alice,
        json!({ "t": "change", "fileId": shared.main, "rev": alice_rev, "op": insert_at(0, "A", length) }),
    )
    .await;
    assert_eq!(until(&mut alice, "ack").await["length"], length + 1);
    let seen = until(&mut bob, "remote").await;
    assert_eq!(seen["op"], json!(["A", length]));
    assert_eq!(seen["rev"], bob_rev + 1);
    send_web(
        &mut bob,
        json!({ "t": "change", "fileId": shared.main, "rev": bob_rev + 1, "op": insert_at(length + 1, "B", length + 1) }),
    )
    .await;
    assert_eq!(until(&mut bob, "ack").await["length"], length + 2);
    let seen = until(&mut alice, "remote").await;
    assert_eq!(seen["op"], json!([length + 1, "B"]));
    let stored = people::read::<Value>(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{}", shared.project),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(stored["head_seq"], 2);
}

#[tokio::test]
async fn comments_written_in_the_browser_reach_everyone_and_follow_every_action() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Editor).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    let rev = opened(&mut socket, &shared.main).await;
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "comment", "action": "create", "fileId": shared.main, "path": "main.tex",
                "from": 0, "to": 5, "rev": rev, "body": "Why hello, @Bob Smith?", "members": [] }),
        "c1",
    )
    .await;
    assert_eq!(done, json!({ "t": "done", "reqId": "c1" }));
    let threads = last_threads(&frames);
    assert_eq!(threads.len(), 1);
    let thread = &threads[0];
    assert_eq!(thread["anchor"]["quote"], "Hello");
    assert_eq!(thread["anchor"]["range"], json!({ "from": 0, "to": 5 }));
    assert_eq!(
        thread["createdBy"],
        Value::String(stage.alice.tokens.account_id.to_string())
    );
    assert_eq!(thread["verified"], true);
    assert_eq!(
        thread["messages"][0]["mentions"],
        json!([stage.bob.tokens.account_id.to_string()])
    );
    let thread_id = thread["id"].as_str().expect("a thread id").to_string();
    desktop.hear_update().await;
    assert_eq!(desktop.doc.get_map("comments").len(), 1);
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "comment", "action": "reply", "threadId": thread_id, "body": "Second", "members": [] }),
        "c2",
    )
    .await;
    assert_eq!(done["t"], "done");
    let messages = last_threads(&frames)[0]["messages"]
        .as_array()
        .cloned()
        .expect("messages");
    assert_eq!(messages.len(), 2);
    let reply = messages[1]["id"].as_str().expect("an id").to_string();
    let (frames, _) = act(
        &mut socket,
        json!({ "t": "comment", "action": "edit", "threadId": thread_id, "messageId": reply, "body": "Second, edited", "members": [] }),
        "c3",
    )
    .await;
    let edited = &last_threads(&frames)[0]["messages"][1];
    assert_eq!(edited["body"], "Second, edited");
    assert!(edited["editedAt"].as_i64().is_some());
    let (frames, _) = act(
        &mut socket,
        json!({ "t": "comment", "action": "resolve", "threadId": thread_id }),
        "c4",
    )
    .await;
    assert_eq!(
        last_threads(&frames)[0]["resolved"]["by"],
        Value::String(stage.alice.tokens.account_id.to_string())
    );
    let (frames, _) = act(
        &mut socket,
        json!({ "t": "comment", "action": "reopen", "threadId": thread_id }),
        "c5",
    )
    .await;
    assert_eq!(last_threads(&frames)[0]["resolved"], Value::Null);
    let (frames, _) = act(
        &mut socket,
        json!({ "t": "comment", "action": "delete", "threadId": thread_id, "messageId": reply }),
        "c6",
    )
    .await;
    assert_eq!(last_threads(&frames)[0]["messages"][1]["deleted"], true);
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "comment", "action": "delete_thread", "threadId": thread_id }),
        "c7",
    )
    .await;
    assert_eq!(done["t"], "done");
    assert!(last_threads(&frames).is_empty());
    let (_, stale) = act(
        &mut socket,
        json!({ "t": "comment", "action": "create", "fileId": shared.main, "from": 0, "to": 5,
                "rev": rev + 40, "body": "Late", "members": [] }),
        "c8",
    )
    .await;
    assert_eq!(stale["t"], "error");
    assert_eq!(stale["code"], "comment_selection_changed");
    let (_, empty) = act(
        &mut socket,
        json!({ "t": "comment", "action": "create", "fileId": shared.main, "from": 0, "to": 5,
                "rev": null, "body": "  ", "members": [] }),
        "c9",
    )
    .await;
    assert_eq!(empty["code"], "comment_empty");
}

#[tokio::test]
async fn a_viewer_reads_but_cannot_edit_comment_suggest_or_chat() {
    let (_stage, shared, mut socket, _browser) = alice_in(ProjectRole::Viewer).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "x", length) }),
    )
    .await;
    let reset = until(&mut socket, "reset").await;
    assert_eq!(reset["text"], MAIN_TEXT);
    assert_eq!(reset["rev"], rev + 1);
    let (_, refused) = act(
        &mut socket,
        json!({ "t": "comment", "action": "create", "fileId": shared.main, "from": 0, "to": 5,
                "rev": null, "body": "Hi", "members": [] }),
        "v1",
    )
    .await;
    assert_eq!(refused["code"], "comment_viewer");
    let (_, refused) = act(
        &mut socket,
        json!({ "t": "suggestion", "action": "withdraw", "ids": ["s1"] }),
        "v2",
    )
    .await;
    assert_eq!(refused["code"], "suggestion_role");
    let (_, refused) = act(
        &mut socket,
        json!({ "t": "chat", "action": "send", "body": "Hello" }),
        "v3",
    )
    .await;
    assert_eq!(refused["code"], "chat_role");
    let (_, refused) = act(&mut socket, json!({ "t": "mode", "mode": "editing" }), "v4").await;
    assert_eq!(refused["code"], "suggestion_role");
}

#[tokio::test]
async fn an_owner_switches_to_suggesting_and_back_and_the_server_keeps_the_choice() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Editor).await;
    let mut desktop = Desktop::open(&stage, &stage.alice, &shared, DESKTOP_PEER).await;
    let browser = browser_sign_in(&stage.server, "github", "/web/").await;
    let mut socket = web_socket(&stage.server, &browser, shared.project).await;
    let hello = until(&mut socket, "hello").await;
    assert_eq!(hello["role"], "owner");
    for (frame, code) in [
        (
            json!({ "t": "suggestion", "action": "accept", "ids": ["s1"] }),
            "suggestion_not_found",
        ),
        (
            json!({ "t": "suggestion", "action": "reject_file", "fileId": "f" }),
            "not_found",
        ),
        (json!({ "t": "nonsense" }), "invalid"),
    ] {
        let (_, answer) = act(&mut socket, frame.clone(), "r").await;
        assert_eq!(answer["t"], "error", "{frame}");
        assert_eq!(answer["code"], code, "{frame}");
    }
    let (_, chosen) = act(
        &mut socket,
        json!({ "t": "mode", "mode": "suggesting" }),
        "m1",
    )
    .await;
    assert_eq!(chosen, json!({ "t": "done", "reqId": "m1" }));
    send_web(&mut socket, json!({ "t": "open", "fileId": shared.main })).await;
    let rev = until(&mut socket, "opened").await["rev"]
        .as_u64()
        .expect("a revision");
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "Hi ", length) }),
    )
    .await;
    assert_eq!(until(&mut socket, "ack").await["rev"], rev + 1);
    let listed = until(&mut socket, "suggestions").await;
    assert_eq!(listed["rev"], rev + 1);
    let suggestion = &listed["suggestions"][0];
    assert_eq!(suggestion["kind"], "insert");
    assert_eq!(suggestion["text"], "Hi ");
    assert_eq!(
        suggestion["author"],
        Value::String(stage.bob.tokens.account_id.to_string())
    );
    desktop.hear_update().await;
    assert_eq!(
        desktop
            .project_doc()
            .suggestions(&shared.main)
            .unwrap()
            .len(),
        1
    );
    let (_, chosen) = act(&mut socket, json!({ "t": "mode", "mode": "editing" }), "m2").await;
    assert_eq!(chosen["t"], "done");
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev + 1, "op": insert_at(length + 3, "!", length + 3) }),
    )
    .await;
    assert_eq!(until(&mut socket, "ack").await["length"], length + 4);
    let listed = until(&mut socket, "suggestions").await;
    assert_eq!(listed["suggestions"].as_array().map(Vec::len), Some(1));
    desktop.hear_update().await;
    assert_eq!(desktop.text(&shared.main), format!("Hi {MAIN_TEXT}!"));
    assert_eq!(
        desktop
            .project_doc()
            .suggestions(&shared.main)
            .unwrap()
            .len(),
        1
    );
    let (_, chosen) = act(
        &mut socket,
        json!({ "t": "mode", "mode": "suggesting" }),
        "m3",
    )
    .await;
    assert_eq!(chosen["t"], "done");
    drop(socket);
    let mut again = web_socket(&stage.server, &browser, shared.project).await;
    until(&mut again, "hello").await;
    send_web(&mut again, json!({ "t": "open", "fileId": shared.main })).await;
    let reopened = until(&mut again, "opened").await;
    let rev = reopened["rev"].as_u64().expect("a revision");
    let length = utf16(reopened["text"].as_str().expect("text"));
    send_web(
        &mut again,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "So ", length) }),
    )
    .await;
    until(&mut again, "ack").await;
    let listed = until_where(&mut again, |frame| {
        frame["t"] == "suggestions" && frame["rev"] == rev + 1
    })
    .await;
    assert_eq!(listed["suggestions"].as_array().map(Vec::len), Some(1));
    assert_eq!(listed["suggestions"][0]["text"], "So Hi ");
}

async fn suggest_from(
    desktop: &mut Desktop,
    person: &people::Person,
    file: &str,
    operation: &TextOperation,
) -> ServerFrame {
    let mut doc = desktop.project_doc();
    doc.set_peer_id(DESKTOP_PEER).expect("peer");
    let before = doc.version();
    doc.suggest_operation(
        file,
        operation,
        person.tokens.account_id,
        Some(person.tokens.device_id),
        10,
    )
    .expect("the suggestion is made");
    let update = doc.export_since(&before).expect("update");
    desktop.doc.import(&update).expect("the desktop keeps it");
    desktop.send(person, &update).await
}

fn operation(parts: Value) -> TextOperation {
    serde_json::from_value(parts).expect("an operation")
}

#[tokio::test]
async fn a_browser_reviewers_edits_become_suggestions_a_desktop_sees() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Reviewer).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    let (_, refused) = act(&mut socket, json!({ "t": "mode", "mode": "editing" }), "m").await;
    assert_eq!(refused["code"], "suggestion_role");
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(5, ", dear", length) }),
    )
    .await;
    assert_eq!(until(&mut socket, "ack").await["length"], length + 6);
    let listed = until(&mut socket, "suggestions").await;
    assert_eq!(listed["rev"], rev + 1);
    assert_eq!(listed["suggestions"][0]["kind"], "insert");
    assert_eq!(
        (
            listed["suggestions"][0]["from"].clone(),
            listed["suggestions"][0]["to"].clone()
        ),
        (json!(5), json!(11))
    );
    desktop.hear_update().await;
    assert_eq!(desktop.text(&shared.main), "Hello, dear world\n");
    let seen = desktop.project_doc().suggestions(&shared.main).unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(
        seen[0].kind,
        oleafly_collab::suggestions::SuggestionKind::Insert
    );
    assert_eq!(seen[0].author, stage.alice.tokens.account_id);
    assert_eq!(seen[0].text, ", dear");
    assert_eq!((seen[0].from, seen[0].to), (5, 11));
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev + 1, "op": [12, -5, 1] }),
    )
    .await;
    assert_eq!(until(&mut socket, "ack").await["length"], length + 1);
    let listed = until(&mut socket, "suggestions").await;
    let struck = listed["suggestions"]
        .as_array()
        .expect("suggestions")
        .iter()
        .find(|found| found["kind"] == "delete")
        .cloned()
        .expect("a deletion");
    assert_eq!(struck["text"], "world");
    assert_eq!(
        (struck["from"].clone(), struck["to"].clone()),
        (json!(12), json!(12))
    );
    desktop.hear_update().await;
    assert_eq!(desktop.text(&shared.main), "Hello, dear \n");
    assert_eq!(
        desktop
            .project_doc()
            .suggestions(&shared.main)
            .unwrap()
            .len(),
        2
    );
    let (_, refused) = act(
        &mut socket,
        json!({ "t": "suggestion", "action": "accept", "ids": [struck["id"]] }),
        "a",
    )
    .await;
    assert_eq!(refused["code"], "suggestion_role");
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "suggestion", "action": "withdraw", "ids": [struck["id"]] }),
        "w",
    )
    .await;
    assert_eq!(done["t"], "done");
    assert!(frames
        .iter()
        .any(|frame| frame["t"] == "remote" && frame["op"] == json!([12, "world", 1])));
    let left = frames
        .iter()
        .rev()
        .find(|frame| frame["t"] == "suggestions")
        .expect("the list after the withdrawal");
    assert_eq!(left["suggestions"].as_array().map(Vec::len), Some(1));
    desktop.hear_update().await;
    assert_eq!(desktop.text(&shared.main), "Hello, dear world\n");
    let stored = people::read::<Value>(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{}", shared.project),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(stored["head_seq"], 3);
}

#[tokio::test]
async fn a_browser_owner_accepts_and_rejects_a_desktop_reviewers_suggestions() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Reviewer).await;
    let mut desktop = Desktop::open(&stage, &stage.alice, &shared, DESKTOP_PEER).await;
    let browser = browser_sign_in(&stage.server, "github", "/web/").await;
    let mut socket = web_socket(&stage.server, &browser, shared.project).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    let insertion = operation(json!([5, ", dear", length - 5]));
    assert!(matches!(
        suggest_from(&mut desktop, &stage.alice, &shared.main, &insertion).await,
        ServerFrame::Ack { .. }
    ));
    let remote = until(&mut socket, "remote").await;
    assert_eq!(remote["op"], json!([5, ", dear", length - 5]));
    let listed = until(&mut socket, "suggestions").await;
    assert_eq!(listed["rev"], rev + 1);
    let added = &listed["suggestions"][0];
    assert_eq!(added["text"], ", dear");
    assert_eq!(
        added["author"],
        Value::String(stage.alice.tokens.account_id.to_string())
    );
    assert_eq!(added["verified"], true);
    let added = added["id"].clone();
    let deletion = operation(json!([12, -5, 1]));
    assert!(matches!(
        suggest_from(&mut desktop, &stage.alice, &shared.main, &deletion).await,
        ServerFrame::Ack { .. }
    ));
    let listed = until_where(&mut socket, |frame| {
        frame["t"] == "suggestions" && frame["suggestions"].as_array().map(Vec::len) == Some(2)
    })
    .await;
    assert_eq!(listed["rev"], rev + 2);
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "suggestion", "action": "accept", "ids": [added] }),
        "a",
    )
    .await;
    assert_eq!(done["t"], "done");
    let left = frames
        .iter()
        .rev()
        .find(|frame| frame["t"] == "suggestions")
        .expect("the list after accepting");
    assert_eq!(left["suggestions"].as_array().map(Vec::len), Some(1));
    assert_eq!(left["suggestions"][0]["kind"], "delete");
    desktop.hear_update().await;
    assert_eq!(desktop.text(&shared.main), "Hello, dear \n");
    assert_eq!(
        desktop
            .project_doc()
            .suggestions(&shared.main)
            .unwrap()
            .len(),
        1
    );
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "suggestion", "action": "reject_file", "fileId": shared.main }),
        "r",
    )
    .await;
    assert_eq!(done["t"], "done");
    assert!(frames
        .iter()
        .any(|frame| frame["t"] == "remote" && frame["op"] == json!([12, "world", 1])));
    let left = frames
        .iter()
        .rev()
        .find(|frame| frame["t"] == "suggestions")
        .expect("the list after rejecting");
    assert_eq!(left["suggestions"], json!([]));
    desktop.hear_update().await;
    assert_eq!(desktop.text(&shared.main), "Hello, dear world\n");
    assert!(desktop
        .project_doc()
        .suggestions(&shared.main)
        .unwrap()
        .is_empty());
    let (_, gone) = act(
        &mut socket,
        json!({ "t": "suggestion", "action": "reject", "ids": [listed["suggestions"][0]["id"]] }),
        "g",
    )
    .await;
    assert_eq!(gone["code"], "suggestion_not_found");
}

#[tokio::test]
async fn a_commenter_in_the_browser_comments_and_chats_but_never_changes_the_text() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Commenter).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "x", length) }),
    )
    .await;
    let reset = until(&mut socket, "reset").await;
    assert_eq!(reset["text"], MAIN_TEXT);
    for (frame, code) in [
        (
            json!({ "t": "mode", "mode": "suggesting" }),
            "suggestion_role",
        ),
        (
            json!({ "t": "suggestion", "action": "withdraw", "ids": ["s1"] }),
            "suggestion_role",
        ),
        (
            json!({ "t": "suggestion", "action": "accept_file", "fileId": shared.main }),
            "suggestion_role",
        ),
        (json!({ "t": "chat", "action": "clear" }), "chat_role"),
    ] {
        let (_, refused) = act(&mut socket, frame.clone(), "r").await;
        assert_eq!(refused["code"], code, "{frame}");
    }
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "comment", "action": "create", "fileId": shared.main, "path": "main.tex",
                "from": 0, "to": 5, "rev": rev + 1, "body": "Is this the opening?", "members": [] }),
        "c",
    )
    .await;
    assert_eq!(done["t"], "done");
    assert_eq!(last_threads(&frames)[0]["anchor"]["quote"], "Hello");
    desktop.hear_update().await;
    assert_eq!(desktop.doc.get_map("comments").len(), 1);
    let (frames, done) = act(
        &mut socket,
        json!({ "t": "chat", "action": "send", "body": "Read it all" }),
        "s",
    )
    .await;
    assert_eq!(done["t"], "done");
    let chat = frames
        .iter()
        .rev()
        .find(|frame| frame["t"] == "chat")
        .expect("the chat after sending");
    assert_eq!(chat["messages"][0]["body"], "Read it all");
    desktop.hear_update().await;
    assert_eq!(desktop.doc.get_list("chat").len(), 1);
    assert_eq!(desktop.text(&shared.main), MAIN_TEXT);
    let stored = people::read::<Value>(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{}", shared.project),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(stored["head_seq"], 2);
}

#[tokio::test]
async fn chat_is_sent_listed_deleted_and_cleared_by_the_owner() {
    let (stage, shared, mut alice, alice_browser) = alice_in(ProjectRole::Editor).await;
    let bob_browser = browser_sign_in(&stage.server, "github", "/web/").await;
    let mut bob = web_socket(&stage.server, &bob_browser, shared.project).await;
    until(&mut alice, "hello").await;
    until(&mut bob, "hello").await;
    assert_eq!(until(&mut bob, "chat").await["messages"], json!([]));
    let (_, done) = act(
        &mut alice,
        json!({ "t": "chat", "action": "send", "body": "First" }),
        "1",
    )
    .await;
    assert_eq!(done["t"], "done");
    let heard = until(&mut bob, "chat").await;
    assert_eq!(heard["messages"][0]["body"], "First");
    assert_eq!(
        heard["messages"][0]["author"],
        Value::String(stage.alice.tokens.account_id.to_string())
    );
    assert_eq!(heard["messages"][0]["verified"], true);
    let first = heard["messages"][0]["id"].clone();
    let (frames, _) = act(
        &mut alice,
        json!({ "t": "chat", "action": "send", "body": "Second" }),
        "2",
    )
    .await;
    let latest = frames
        .iter()
        .rev()
        .find(|frame| frame["t"] == "chat")
        .expect("the chat after sending");
    assert_eq!(latest["messages"].as_array().map(Vec::len), Some(2));
    let (_, empty) = act(
        &mut alice,
        json!({ "t": "chat", "action": "send", "body": "   " }),
        "3",
    )
    .await;
    assert_eq!(empty["code"], "comment_empty");
    let (_, not_hers) = act(
        &mut bob,
        json!({ "t": "chat", "action": "delete", "id": first }),
        "4",
    )
    .await;
    assert_eq!(not_hers["code"], "forbidden");
    let (frames, done) = act(
        &mut alice,
        json!({ "t": "chat", "action": "delete", "id": first }),
        "5",
    )
    .await;
    assert_eq!(done["t"], "done");
    let latest = frames
        .iter()
        .rev()
        .find(|frame| frame["t"] == "chat")
        .expect("the chat after deleting");
    assert_eq!(latest["messages"][0]["deleted"], true);
    assert_eq!(latest["messages"][0]["body"], "");
    assert_eq!(latest["messages"][1]["body"], "Second");
    let (_, refused) = act(&mut alice, json!({ "t": "chat", "action": "clear" }), "6").await;
    assert_eq!(refused["code"], "chat_role");
    let (_, done) = act(&mut bob, json!({ "t": "chat", "action": "clear" }), "7").await;
    assert_eq!(done["t"], "done");
    let cleared = until(&mut alice, "chat").await;
    assert!(cleared["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .all(|message| message["deleted"] == true));
    drop(alice);
    let mut again = web_socket(&stage.server, &alice_browser, shared.project).await;
    until(&mut again, "hello").await;
    let listed = until(&mut again, "chat").await;
    assert_eq!(listed["messages"].as_array().map(Vec::len), Some(2));
    assert!(listed["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .all(|message| message["deleted"] == true));
}

#[tokio::test]
async fn a_new_compile_is_announced_to_open_browsers() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Viewer).await;
    assert_eq!(until(&mut socket, "output").await["items"], json!([]));
    let stored = reqwest::Client::new()
        .put(format!(
            "{}/api/v1/projects/{}/output/pdf",
            stage.server.url(),
            shared.project
        ))
        .bearer_auth(stage.bob.token())
        .header(MAIN_FILE_HEADER, "main.tex")
        .body(b"%PDF-1.7\nx".to_vec())
        .send()
        .await
        .expect("upload");
    assert_eq!(stored.status(), StatusCode::OK);
    let output = until(&mut socket, "output").await;
    assert_eq!(output["items"][0]["kind"], "pdf");
    assert_eq!(output["items"][0]["mainFile"], "main.tex");
    assert_eq!(
        output["items"][0]["compiledBy"],
        Value::String(stage.bob.tokens.account_id.to_string())
    );
}

async fn frames_until_remote(socket: &mut WebSocket) -> Vec<Value> {
    let mut before = Vec::new();
    loop {
        let frame = next_web(socket).await.expect("a frame");
        if frame["t"] == "remote" {
            return before;
        }
        before.push(frame);
    }
}

#[tokio::test]
async fn a_compile_setting_changed_in_the_app_reaches_every_browser_once() {
    let (stage, shared, mut viewer, _browser) = alice_in(ProjectRole::Viewer).await;
    let owner_browser = browser_sign_in(&stage.server, "github", "/web/").await;
    let mut owner = web_socket(&stage.server, &owner_browser, shared.project).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    opened(&mut viewer, &shared.main).await;
    until(&mut owner, "hello").await;
    desktop
        .doc
        .get_map(oleafly_collab::settings::SETTINGS)
        .insert("engine", "typst")
        .expect("engine");
    desktop.doc.commit();
    let update = desktop
        .doc
        .export(loro::ExportMode::updates(&desktop.sent))
        .expect("update");
    assert!(matches!(
        desktop.send(&stage.bob, &update).await,
        ServerFrame::Ack { .. }
    ));
    let expected =
        json!({ "t": "compile", "settings": { "main_doc": shared.main, "engine": "typst" } });
    assert_eq!(until(&mut viewer, "compile").await, expected);
    assert_eq!(until(&mut owner, "compile").await, expected);
    for text in ["% one\n", "% two\n"] {
        assert!(matches!(
            desktop.type_at(&stage.bob, &shared.main, 0, text).await,
            ServerFrame::Ack { .. }
        ));
    }
    let mut later = frames_until_remote(&mut viewer).await;
    later.extend(frames_until_remote(&mut viewer).await);
    assert!(
        later.iter().all(|frame| frame["t"] != "compile"),
        "{later:?}"
    );
}

#[tokio::test]
async fn a_role_change_and_a_removal_reach_the_browser() {
    let (stage, shared, mut socket, browser) = alice_in(ProjectRole::Editor).await;
    until(&mut socket, "hello").await;
    let changed = grant(
        &stage.server,
        &stage.bob,
        shared.project,
        &stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(changed.status(), StatusCode::OK);
    let access = until(&mut socket, "access").await;
    assert_eq!(access, json!({ "t": "access", "role": "viewer" }));
    let removed = call(
        &stage.server,
        Method::DELETE,
        &format!(
            "/api/v1/projects/{}/members/{}",
            shared.project, stage.alice.tokens.account_id
        ),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    let access = until(&mut socket, "access").await;
    assert_eq!(access["removed"], true);
    let error = until(&mut socket, "error").await;
    assert_eq!(error["code"], "access_removed");
    assert!(ends(&mut socket).await);
    let mut again = web_socket(&stage.server, &browser, shared.project).await;
    let refused = next_web(&mut again).await.expect("a refusal");
    assert_eq!(refused["t"], "error");
    assert_eq!(refused["code"], "removed");
    assert!(ends(&mut again).await);
}

#[tokio::test]
async fn stopping_sharing_or_signing_out_ends_the_open_socket() {
    let (stage, shared, mut socket, browser) = alice_in(ProjectRole::Editor).await;
    until(&mut socket, "hello").await;
    let mut second = web_socket(&stage.server, &browser, shared.project).await;
    until(&mut second, "hello").await;
    assert_eq!(browser.sign_out().await.status(), StatusCode::NO_CONTENT);
    for socket in [&mut socket, &mut second] {
        let error = until(socket, "error").await;
        assert_eq!(error["code"], "signed_out");
        assert!(ends(socket).await);
    }
    let fresh = browser_sign_in(&stage.server, "github2", "/web/").await;
    let mut third = web_socket(&stage.server, &fresh, shared.project).await;
    until(&mut third, "hello").await;
    let archived = call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{}/archive", shared.project),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    let error = until(&mut third, "error").await;
    assert_eq!(error["code"], "project_removed");
    assert!(ends(&mut third).await);
}

#[tokio::test]
async fn an_open_socket_ends_when_its_browser_session_expires() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Editor).await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    stage
        .server
        .clock()
        .advance(oleafly_server::web_sessions::SESSION_TTL_MS - 1_500);
    let mut socket = web_socket(&stage.server, &browser, shared.project).await;
    until(&mut socket, "hello").await;
    let ended = until(&mut socket, "error").await;
    assert_eq!(ended["code"], "session_expired");
    assert!(ends(&mut socket).await);
}

#[tokio::test]
async fn a_project_beyond_the_memory_budget_is_refused_before_hello() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Editor).await;
    stage.server.state().snapshots.set_budget(Budget {
        memory_bytes: 16,
        max_snapshot_bytes: 1 << 30,
    });
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let mut socket = web_socket(&stage.server, &browser, shared.project).await;
    let refused = next_web(&mut socket).await.expect("a refusal");
    assert_eq!(refused["t"], "error");
    assert_eq!(refused["code"], "project_too_large");
    assert!(ends(&mut socket).await);
}

#[tokio::test]
async fn cursors_travel_between_a_desktop_and_a_browser() {
    let (stage, shared, mut socket, _browser) = alice_in(ProjectRole::Editor).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    until(&mut socket, "hello").await;
    send_frame(
        &mut desktop.socket,
        &ClientFrame::Presence {
            project_id: shared.project,
            state: PresenceState {
                file_id: Some(shared.main.clone()),
                cursor: Some(3),
                anchor: Some(1),
            },
        },
    )
    .await;
    let presence = until_where(&mut socket, |frame| {
        frame["t"] == "presence" && !frame["peers"].as_array().is_some_and(Vec::is_empty)
    })
    .await;
    let peer = &presence["peers"][0];
    assert_eq!(
        peer["deviceId"],
        Value::String(stage.bob.tokens.device_id.to_string())
    );
    assert_eq!(
        peer["accountId"],
        Value::String(stage.bob.tokens.account_id.to_string())
    );
    assert_eq!(peer["name"], "Bob Smith");
    assert_eq!(peer["fileId"], shared.main.as_str());
    assert_eq!(peer["anchor"], 1);
    assert_eq!(peer["head"], 3);
    send_web(
        &mut socket,
        json!({ "t": "presence", "fileId": shared.main, "anchor": 2, "head": 4 }),
    )
    .await;
    let heard = desktop
        .hear_frame(|frame| matches!(frame, ServerFrame::Presence { .. }))
        .await;
    let ServerFrame::Presence {
        account_id, state, ..
    } = heard
    else {
        unreachable!()
    };
    assert_eq!(account_id, stage.alice.tokens.account_id);
    assert_eq!(state.cursor, Some(4));
    assert_eq!(state.anchor, Some(2));
    drop(desktop.socket);
    let left = until_where(&mut socket, |frame| {
        frame["t"] == "presence" && frame["peers"].as_array().is_some_and(Vec::is_empty)
    })
    .await;
    assert_eq!(left["peers"], json!([]));
}

#[tokio::test]
async fn a_file_a_desktop_adds_shows_in_the_browser_tree_and_a_reopened_socket_sees_the_latest_text(
) {
    let (stage, shared, mut socket, browser) = alice_in(ProjectRole::Editor).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    until(&mut socket, "hello").await;
    let tree = desktop.doc.get_tree("tree");
    let node = tree.create(loro::TreeParentId::Root).expect("a new file");
    let meta = tree.get_meta(node).expect("meta");
    meta.insert("id", "01920000-0000-7000-8000-0000000000e1")
        .expect("id");
    meta.insert("name", "refs.bib").expect("name");
    meta.insert("kind", "text").expect("kind");
    assert!(matches!(
        desktop
            .type_at(&stage.bob, &shared.main, 0, "% top\n")
            .await,
        ServerFrame::Ack { .. }
    ));
    let listed = until_where(&mut socket, |frame| {
        frame["t"] == "tree"
            && frame["files"]
                .as_array()
                .is_some_and(|files| files.iter().any(|file| file["path"] == "refs.bib"))
    })
    .await;
    assert!(listed["files"]
        .as_array()
        .expect("files")
        .iter()
        .any(|file| file["path"] == "main.tex"));
    drop(socket);
    assert!(matches!(
        desktop
            .type_at(&stage.bob, &shared.main, 0, "% again\n")
            .await,
        ServerFrame::Ack { .. }
    ));
    let mut again = web_socket(&stage.server, &browser, shared.project).await;
    let hello = until(&mut again, "hello").await;
    assert!(hello["files"]
        .as_array()
        .expect("files")
        .iter()
        .any(|file| file["path"] == "refs.bib"));
    send_web(&mut again, json!({ "t": "open", "fileId": shared.main })).await;
    let opened = until(&mut again, "opened").await;
    assert_eq!(opened["text"], format!("% again\n% top\n{MAIN_TEXT}"));
}

async fn open_text(socket: &mut WebSocket, file: &str, resume: Option<&str>) -> Value {
    let mut frame = json!({ "t": "open", "fileId": file });
    if let Some(resume) = resume {
        frame["resume"] = json!(resume);
    }
    send_web(socket, frame).await;
    until(socket, "opened").await
}

#[tokio::test]
async fn a_change_whose_ack_was_lost_is_reported_on_reopen_and_never_applied_twice() {
    let (stage, shared, mut first, browser) = alice_in(ProjectRole::Editor).await;
    let rev = opened(&mut first, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut first,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "Hi ", length), "id": "tab:1" }),
    )
    .await;
    assert_eq!(until(&mut first, "ack").await["rev"], rev + 1);
    let mut second = web_socket(&stage.server, &browser, shared.project).await;
    until(&mut second, "hello").await;
    let resumed = open_text(&mut second, &shared.main, Some("tab:1")).await;
    assert_eq!(resumed["resumed"], true);
    assert_eq!(resumed["text"], format!("Hi {MAIN_TEXT}"));
    let lost = open_text(&mut second, &shared.main, Some("tab:2")).await;
    assert_eq!(lost["resumed"], false);
    let plain = open_text(&mut second, &shared.main, None).await;
    assert!(plain.get("resumed").is_none(), "{plain}");
    send_web(
        &mut first,
        json!({ "t": "change", "fileId": shared.main, "rev": rev + 1, "op": insert_at(0, "X", length + 3), "id": "tab:2" }),
    )
    .await;
    send_web(
        &mut first,
        json!({ "t": "change", "fileId": shared.main, "rev": rev + 1, "op": insert_at(0, "Y", length + 3), "id": "tab:3" }),
    )
    .await;
    let ack = until(&mut first, "ack").await;
    assert_eq!(ack["rev"], rev + 2);
    assert_eq!(ack["length"], length + 4);
    send_web(
        &mut first,
        json!({ "t": "change", "fileId": shared.main, "rev": rev + 2, "op": insert_at(0, "Z", length + 4), "id": "tab:3" }),
    )
    .await;
    send_web(
        &mut first,
        json!({ "t": "change", "fileId": shared.main, "rev": rev + 2, "op": insert_at(0, "W", length + 4), "id": "tab:4" }),
    )
    .await;
    let ack = until(&mut first, "ack").await;
    assert_eq!(ack["rev"], rev + 3);
    assert_eq!(ack["length"], length + 5);
    let again = open_text(&mut second, &shared.main, None).await;
    assert_eq!(again["text"], format!("WYHi {MAIN_TEXT}"));
}

#[tokio::test]
async fn a_suggestion_refused_partway_leaves_nothing_behind_in_the_room() {
    let (stage, shared, mut socket, browser) = alice_in(ProjectRole::Reviewer).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    let long = "x".repeat(20_010);
    assert!(matches!(
        desktop.type_at(&stage.bob, &shared.main, 0, &long).await,
        ServerFrame::Ack { .. }
    ));
    until(&mut socket, "hello").await;
    let full = format!("{long}{MAIN_TEXT}");
    let opened = open_text(&mut socket, &shared.main, None).await;
    assert_eq!(opened["text"], full);
    let rev = opened["rev"].as_u64().expect("a revision");
    let rest = utf16(&full) - 20_005;
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": ["y", -20_005, rest] }),
    )
    .await;
    let refused = until(&mut socket, "error").await;
    assert_ne!(refused["code"], "server_busy");
    let mut other = web_socket(&stage.server, &browser, shared.project).await;
    until(&mut other, "hello").await;
    let seen = open_text(&mut other, &shared.main, None).await;
    assert_eq!(seen["text"], full);
}

#[tokio::test]
async fn reloading_a_room_after_a_refused_change_frees_the_old_copy_first() {
    let mut config = web_support::web_config();
    config.limits.max_project_mb = 1;
    config.limits.max_file_mb = 1;
    let stage = people::stage_with(config).await;
    let shared = share_doc_project(&stage, ProjectRole::Editor).await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let mut socket = web_socket(&stage.server, &browser, shared.project).await;
    let rev = opened(&mut socket, &shared.main).await;
    let snapshots = &stage.server.state().snapshots;
    let room = snapshots.in_use();
    assert!(room > 0);
    snapshots.set_budget(Budget {
        memory_bytes: room + room / 2,
        max_snapshot_bytes: 1 << 30,
    });
    let length = utf16(MAIN_TEXT);
    let paste = "p".repeat(1_200_000);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, &paste, length) }),
    )
    .await;
    let (mut refused, mut reset) = (None, None);
    while refused.is_none() || reset.is_none() {
        let frame = next_web(&mut socket)
            .await
            .expect("the socket stays open after a refusal");
        match frame["t"].as_str() {
            Some("error") => refused = Some(frame),
            Some("reset") => reset = Some(frame),
            _ => {}
        }
    }
    let (refused, reset) = (refused.unwrap_or_default(), reset.unwrap_or_default());
    assert_eq!(refused["code"], "too_large", "{refused}");
    assert_eq!(reset["text"], MAIN_TEXT);
    let after = reset["rev"].as_u64().expect("a revision");
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": after, "op": insert_at(0, "ok ", length) }),
    )
    .await;
    assert_eq!(until(&mut socket, "ack").await["length"], length + 3);
}

async fn browser_writers(stage: &people::Stage, shared: &Shared) -> usize {
    let project = shared.project;
    let alice = stage.alice.tokens.account_id;
    let rows = stage
        .server
        .state()
        .db
        .read(move |conn| oleafly_server::peers::table(conn, project))
        .await
        .expect("peers");
    rows.iter().filter(|row| row.account_id == alice).count()
}

#[tokio::test]
async fn a_browser_writes_with_one_writer_id_across_room_loads() {
    let (stage, shared, mut socket, browser) = alice_in(ProjectRole::Editor).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "A", length) }),
    )
    .await;
    until(&mut socket, "ack").await;
    assert_eq!(browser_writers(&stage, &shared).await, 1);
    drop(socket);
    let web = &stage.server.state().web;
    for _ in 0..200 {
        web.shed();
        if web.live(shared.project).is_none() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(web.live(shared.project).is_none(), "the room was let go");
    let mut again = web_socket(&stage.server, &browser, shared.project).await;
    until(&mut again, "hello").await;
    let opened = open_text(&mut again, &shared.main, None).await;
    let rev = opened["rev"].as_u64().expect("a revision");
    send_web(
        &mut again,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(0, "B", length + 1) }),
    )
    .await;
    until(&mut again, "ack").await;
    assert_eq!(browser_writers(&stage, &shared).await, 1);
}

#[tokio::test]
async fn a_browser_that_joins_hears_suggestions_in_files_it_has_not_opened() {
    let (stage, shared, mut socket, browser) = alice_in(ProjectRole::Reviewer).await;
    let rev = opened(&mut socket, &shared.main).await;
    let length = utf16(MAIN_TEXT);
    send_web(
        &mut socket,
        json!({ "t": "change", "fileId": shared.main, "rev": rev, "op": insert_at(5, ", dear", length) }),
    )
    .await;
    until(&mut socket, "ack").await;
    let mut joined = web_socket(&stage.server, &browser, shared.project).await;
    until(&mut joined, "hello").await;
    let listed = until(&mut joined, "suggestions").await;
    assert_eq!(listed["fileId"], shared.main.as_str());
    assert_eq!(listed["rev"], Value::Null);
    assert_eq!(listed["suggestions"][0]["kind"], "insert");
}

#[tokio::test]
async fn idle_browser_rooms_are_capped_per_person_and_give_way_when_memory_is_short() {
    let stage = web_stage().await;
    let first = share_doc_project(&stage, ProjectRole::Editor).await;
    let second = share_doc_project(&stage, ProjectRole::Editor).await;
    let third = share_doc_project(&stage, ProjectRole::Editor).await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let state = stage.server.state();
    for shared in [&first, &second, &third] {
        browser
            .json(&format!("/web/api/projects/{}", shared.project))
            .await;
    }
    assert!(state.web.live(first.project).is_none());
    assert!(state.web.live(second.project).is_some());
    assert!(state.web.live(third.project).is_some());
    let held = state.snapshots.in_use();
    state.snapshots.set_budget(Budget {
        memory_bytes: held + held / 4,
        max_snapshot_bytes: 1 << 30,
    });
    let read = state
        .snapshots
        .read_current(&state.db, first.project)
        .await
        .expect("a read");
    assert!(
        matches!(read, oleafly_server::snapshots::Current::Read(..)),
        "the idle rooms gave their memory to the read"
    );
}
