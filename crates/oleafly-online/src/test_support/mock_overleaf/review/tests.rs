use serde_json::{json, Value};

use super::super::{
    DocFormat, MockOverleaf, MockPeer, MockProject, MockUser, Privilege, MOCK_CSRF,
};
use crate::html;
use crate::test_support::overleaf_rt::{probe, recordings};

const T1: &str = "5f00000000000000000000b1";
const T2: &str = "5f00000000000000000000b2";

fn project(format: DocFormat) -> MockProject {
    MockProject::new("Review module")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("erin"))
        .format(format)
        .doc("main.tex", "One two three four")
}

async fn mock(format: DocFormat, review: bool) -> (MockOverleaf, String) {
    let mock = MockOverleaf::start(project(format)).await;
    mock.configure(|config| config.review = review);
    let main = mock.doc_id("main.tex");
    (mock, main)
}

fn joined(mock: &MockOverleaf, name: &str, doc: &str) -> MockPeer {
    let mut peer = mock.peer(name);
    peer.join(doc);
    peer
}

fn raw_joined(mock: &MockOverleaf, name: &str, doc: &str) -> MockPeer {
    let mut peer = mock.peer(name);
    join_reply(&mut peer, doc, true);
    peer
}

fn update_ok(reply: Option<Vec<Value>>) -> bool {
    reply.is_some_and(|reply| reply.first().is_none_or(Value::is_null))
}

fn apply(peer: &mut MockPeer, doc: &str, v: u64, op: Value, meta: Option<Value>) -> bool {
    let mut update = json!({ "doc": doc, "v": v, "op": op });
    if let Some(meta) = meta {
        update["meta"] = meta;
    }
    let reply = peer.emit("applyOtUpdate", vec![json!(doc), update]);
    update_ok(reply) && peer.is_connected()
}

fn join_reply(peer: &mut MockPeer, doc: &str, encode: bool) -> Vec<Value> {
    peer.emit(
        "joinDoc",
        vec![
            json!(doc),
            json!({ "encodeRanges": encode, "supportsHistoryOT": true }),
        ],
    )
    .unwrap()
}

async fn page_meta(mock: &MockOverleaf) -> std::collections::HashMap<String, String> {
    let page = reqwest::Client::new()
        .get(mock.project_page_url())
        .header("Cookie", mock.user("alice").cookie())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    html::meta_tags(&page)
}

#[tokio::test]
async fn the_switch_shows_in_the_page_and_the_join_like_ce_and_pro() {
    let recorded = recordings()
        .into_iter()
        .find(|recording| recording.name == "history-ot-tracked-delete")
        .unwrap();
    let ce: Value = serde_json::from_str(&recorded.extra("scenario.json").unwrap()).unwrap();
    assert_eq!(ce["pageMeta"]["ol-hasTrackChangesFeature"], json!(""));
    let (community, _) = mock(DocFormat::ShareJs, false).await;
    assert!(!page_meta(&community)
        .await
        .contains_key("ol-hasTrackChangesFeature"));
    let (pro, _) = mock(DocFormat::ShareJs, true).await;
    assert_eq!(
        page_meta(&pro)
            .await
            .get("ol-hasTrackChangesFeature")
            .map(String::as_str),
        Some("")
    );
    let mut peer = community.peer("alice");
    let join = &peer.events("joinProjectResponse")[0][0];
    assert_eq!(join["project"]["features"]["trackChanges"], json!(true));
    assert_eq!(
        join["project"]["features"]["trackChangesVisible"],
        json!(false)
    );
    let mut peer = pro.peer("alice");
    let join = &peer.events("joinProjectResponse")[0][0];
    assert_eq!(
        join["project"]["features"]["trackChangesVisible"],
        json!(true)
    );
}

#[tokio::test]
async fn sharejs_ranges_follow_ops_with_ids_from_the_suggestion_seed() {
    let (mock, main) = mock(DocFormat::ShareJs, true).await;
    let mut carol = joined(&mock, "carol", &main);
    carol.track_insert(&main, 3, " and");
    carol.track_delete(&main, 0, 3);
    let ranges = mock.ranges(&main);
    let changes = ranges["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 2);
    let carol_id = mock.user("carol").id;
    let tc = |n: u64| format!("{}{n:08x}", &carol_id[..10]);
    assert_eq!(changes[0]["id"], json!(format!("{}000001", tc(2))));
    assert_eq!(changes[0]["op"], json!({ "d": "One", "p": 0 }));
    assert_eq!(changes[1]["id"], json!(format!("{}000001", tc(1))));
    assert_eq!(changes[1]["op"], json!({ "i": " and", "p": 0 }));
    assert_eq!(changes[1]["metadata"]["user_id"], json!(carol_id));
    assert!(changes[1]["metadata"]["ts"]
        .as_str()
        .is_some_and(|ts| ts.ends_with('Z')));
    let mut bob = joined(&mock, "bob", &main);
    bob.type_at(&main, 2, "!");
    let ranges = mock.ranges(&main);
    assert_eq!(ranges["changes"][1]["op"], json!({ "i": " a", "p": 0 }));
    assert_eq!(ranges["changes"][2]["op"], json!({ "i": "nd", "p": 3 }));
    let split_id = ranges["changes"][2]["id"].as_str().unwrap();
    assert_eq!(split_id.len(), 24);
    assert_ne!(split_id, ranges["changes"][1]["id"].as_str().unwrap());
    let reply = join_reply(&mut bob, &main, true);
    assert_eq!(reply[4]["changes"], ranges["changes"]);
}

#[tokio::test]
async fn a_comment_anchor_needs_only_view_access_and_restricted_users_see_none() {
    let (mock, main) = mock(DocFormat::ShareJs, true).await;
    let mut dave = joined(&mock, "dave", &main);
    let version = mock.doc_version(&main);
    assert!(!apply(
        &mut dave,
        &main,
        version,
        json!([{ "p": 0, "i": "x" }]),
        None
    ));
    let mut dave = joined(&mock, "dave", &main);
    dave.comment(&main, 4, 3, T1);
    assert_eq!(mock.doc_version(&main), version + 1);
    let comments = &mock.ranges(&main)["comments"];
    assert_eq!(comments[0]["op"], json!({ "c": "two", "p": 4, "t": T1 }));
    assert_eq!(
        comments[0]["metadata"]["user_id"],
        json!(mock.user("dave").id)
    );
    let mut bob = joined(&mock, "bob", &main);
    bob.type_at(&main, 5, "W");
    assert_eq!(mock.ranges(&main)["comments"][0]["op"]["c"], json!("tWwo"));
    let mut erin = mock.peer("erin");
    let reply = join_reply(&mut erin, &main, false);
    assert_eq!(reply[4]["comments"], json!([]));
    let mut alice = mock.peer("alice");
    assert_eq!(
        join_reply(&mut alice, &main, false)[4]["comments"],
        mock.ranges(&main)["comments"]
    );
}

#[tokio::test]
async fn an_undo_insert_cancels_a_tracked_delete_unless_the_server_transforms_it() {
    let (mock, main) = mock(DocFormat::ShareJs, true).await;
    let mut carol = joined(&mock, "carol", &main);
    carol.track_delete(&main, 4, 4);
    assert_eq!(mock.ranges(&main)["changes"].as_array().unwrap().len(), 1);
    let mut alice = raw_joined(&mock, "alice", &main);
    let undo = json!([{ "p": 4, "i": "two ", "u": true }]);
    let version = mock.doc_version(&main);
    assert!(apply(&mut alice, &main, version, undo.clone(), None));
    assert_eq!(mock.ranges(&main), json!({}));
    assert_eq!(mock.doc_text(&main), "One two three four");
    carol.sync();
    carol.track_delete(&main, 4, 4);
    let version = mock.doc_version(&main);
    let mut bob = joined(&mock, "bob", &main);
    bob.type_at(&main, 0, ">");
    assert!(apply(&mut alice, &main, version, undo, None));
    assert_eq!(mock.doc_text(&main), ">One two three four");
    let changes = mock.ranges(&main)["changes"].clone();
    assert_eq!(changes.as_array().unwrap().len(), 1, "{changes}");
    assert_eq!(changes[0]["op"], json!({ "d": "two ", "p": 9 }));
}

#[tokio::test]
async fn history_ot_comments_live_in_the_raw_doc_and_follow_text_ops() {
    let (mock, main) = mock(DocFormat::HistoryOt, true).await;
    let mut dave = joined(&mock, "dave", &main);
    dave.comment(&main, 4, 3, T1);
    assert_eq!(
        mock.raw_doc(&main)["comments"],
        json!([{ "id": T1, "ranges": [{ "pos": 4, "length": 3 }] }])
    );
    let version = mock.doc_version(&main);
    assert!(!apply(
        &mut dave,
        &main,
        version,
        json!([{ "commentId": T1, "resolved": true }]),
        None
    ));
    let mut bob = joined(&mock, "bob", &main);
    bob.type_at(&main, 5, "W");
    bob.type_at(&main, 0, ">");
    assert_eq!(
        mock.raw_doc(&main)["comments"],
        json!([{ "id": T1, "ranges": [{ "pos": 5, "length": 1 }, { "pos": 7, "length": 2 }] }])
    );
    bob.comment_edit(&main, json!({ "commentId": T1, "resolved": true }));
    let reply = join_reply(&mut bob, &main, false);
    assert_eq!(reply[1]["comments"][0]["resolved"], json!(true));
    let version = mock.doc_version(&main);
    assert!(apply(
        &mut bob,
        &main,
        version,
        json!([{ "deleteComment": T1 }]),
        None
    ));
    assert_eq!(mock.raw_doc(&main)["comments"], json!([]));
    let version = mock.doc_version(&main);
    assert!(!apply(
        &mut bob,
        &main,
        version,
        json!([{ "commentId": T2, "ranges": [{ "pos": 0, "length": 0 }] }]),
        None
    ));
    assert_eq!(mock.raw_doc(&main)["comments"], json!([]));
    let mut carol = joined(&mock, "carol", &main);
    let version = mock.doc_version(&main);
    assert!(apply(
        &mut carol,
        &main,
        version,
        json!([{ "commentId": T2, "ranges": [] }]),
        None
    ));
    assert_eq!(
        mock.raw_doc(&main)["comments"],
        json!([{ "id": T2, "ranges": [] }])
    );
}

#[tokio::test]
async fn a_comment_sent_before_a_concurrent_edit_lands_where_its_text_went() {
    let (mock, main) = mock(DocFormat::HistoryOt, true).await;
    let mut bob = joined(&mock, "bob", &main);
    let before = mock.doc_version(&main);
    bob.type_at(&main, 0, ">> ");
    let mut dave = joined(&mock, "dave", &main);
    assert!(apply(
        &mut dave,
        &main,
        before,
        json!([{ "commentId": T1, "ranges": [{ "pos": 4, "length": 3 }] }]),
        None
    ));
    assert_eq!(
        mock.raw_doc(&main)["comments"],
        json!([{ "id": T1, "ranges": [{ "pos": 7, "length": 3 }] }])
    );
}

#[tokio::test]
async fn reviewers_may_suggest_on_history_ot_but_not_accept_or_reject() {
    let (mock, main) = mock(DocFormat::HistoryOt, true).await;
    let mut carol = joined(&mock, "carol", &main);
    carol.track_insert(&main, 3, " and");
    let tracked = mock.raw_doc(&main)["trackedChanges"].clone();
    assert_eq!(tracked[0]["range"], json!({ "pos": 3, "length": 4 }));
    let version = mock.doc_version(&main);
    let clear = json!([{ "textOperation": [3, { "r": 4, "tracking": { "type": "none" } }, 15] }]);
    assert!(!apply(&mut carol, &main, version, clear.clone(), None));
    let mut bob = joined(&mock, "bob", &main);
    assert!(apply(&mut bob, &main, version, clear, None));
    assert_eq!(mock.raw_doc(&main)["trackedChanges"], json!([]));
    let mut carol = joined(&mock, "carol", &main);
    carol.track_delete(&main, 0, 1);
    carol.track_delete(&main, 0, 1);
    let tracked = mock.raw_doc(&main)["trackedChanges"].clone();
    assert_eq!(tracked.as_array().unwrap().len(), 1, "{tracked}");
    assert_eq!(tracked[0]["range"], json!({ "pos": 0, "length": 2 }));
}

#[tokio::test]
async fn module_writes_tell_the_room_and_hide_it_from_restricted_users() {
    let (mock, main) = mock(DocFormat::ShareJs, true).await;
    let alice = mock.peer("alice");
    let mut bob = joined(&mock, "bob", &main);
    let mut erin = mock.peer("erin");
    let posted = alice.post_message(T1, "Hello");
    assert_eq!(posted.status, 201);
    let id = posted.body["id"].as_str().unwrap().to_string();
    assert_eq!(bob.events("new-comment")[0][0], json!(T1));
    assert_eq!(
        bob.events("new-comment")[0][1]["user"]["first_name"],
        json!("Alice")
    );
    assert_eq!(alice.edit_message(T1, &id, "Hi").status, 204);
    assert_eq!(
        bob.events("edit-message"),
        vec![vec![json!(T1), json!(id), json!("Hi")]]
    );
    assert_eq!(alice.resolve(&main, T1).status, 204);
    assert_eq!(
        bob.events("resolve-thread")[0][1]["id"],
        json!(mock.user("alice").id)
    );
    assert_eq!(mock.threads()[T1]["resolved"], json!(true));
    assert!(mock.threads()[T1]["resolved_at"].as_str().is_some());
    assert_eq!(alice.reopen(&main, T1).status, 204);
    assert_eq!(bob.events("reopen-thread"), vec![vec![json!(T1)]]);
    assert_eq!(alice.delete_message(T1, &id, true).status, 204);
    assert_eq!(
        bob.events("delete-message"),
        vec![vec![json!(T1), json!(id)]]
    );
    assert_eq!(alice.delete_thread(&main, T1).status, 204);
    assert_eq!(bob.events("delete-thread"), vec![vec![json!(T1)]]);
    let mut carol = joined(&mock, "carol", &main);
    carol.track_insert(&main, 0, "X");
    let change = mock.ranges(&main)["changes"][0]["id"].clone();
    assert_eq!(
        alice
            .accept(&main, &[change.as_str().unwrap().to_string()])
            .status,
        204
    );
    let bob_id = mock.user("bob").id;
    assert_eq!(
        alice
            .set_track_changes(json!({ "on_for_guests": true }))
            .status,
        204
    );
    assert_eq!(
        alice
            .set_track_changes(json!({ "on_for": { bob_id.clone(): true } }))
            .status,
        204
    );
    assert_eq!(
        bob.events("toggle-track-changes").last().cloned(),
        Some(vec![json!({ bob_id: true, "__guests__": true })])
    );
    for name in [
        "new-comment",
        "edit-message",
        "resolve-thread",
        "reopen-thread",
        "delete-message",
        "delete-thread",
    ] {
        assert!(erin.events(name).is_empty(), "{name}");
    }
    assert_eq!(
        erin.events("accept-changes"),
        vec![vec![json!(main), json!([change])]]
    );
    assert_eq!(erin.events("toggle-track-changes").len(), 2);
    assert_eq!(erin.post_message(T2, "Guest").status, 403);
}

#[tokio::test]
async fn resolving_or_deleting_on_history_ot_applies_the_comment_op_for_everyone() {
    let (mock, main) = mock(DocFormat::HistoryOt, true).await;
    let mut dave = joined(&mock, "dave", &main);
    dave.comment(&main, 4, 3, T1);
    let carol = mock.peer("carol");
    assert_eq!(carol.post_message(T1, "Mine").status, 201);
    let version = mock.doc_version(&main);
    assert_eq!(carol.resolve(&main, T1).status, 204);
    assert_eq!(mock.doc_version(&main), version + 1);
    let applied = dave.take_events("otUpdateApplied");
    let last = &applied.last().unwrap()[0];
    assert_eq!(last["op"], json!([{ "commentId": T1, "resolved": true }]));
    assert_eq!(last["v"], json!(version));
    assert_eq!(mock.raw_doc(&main)["comments"][0]["resolved"], json!(true));
    assert_eq!(dave.resolve(&main, T1).status, 403);
    assert_eq!(carol.delete_thread(&main, T1).status, 204);
    let applied = dave.take_events("otUpdateApplied");
    assert_eq!(
        applied.last().unwrap()[0]["op"],
        json!([{ "deleteComment": T1 }])
    );
    assert_eq!(mock.raw_doc(&main)["comments"], json!([]));
    let mut late = mock.peer("bob");
    let reply = late.emit(
        "joinDoc",
        vec![
            json!(main),
            json!(version),
            json!({ "supportsHistoryOT": true }),
        ],
    );
    assert_eq!(reply.unwrap()[3].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn deleting_a_sharejs_thread_drops_its_anchor_without_a_new_version() {
    let (mock, main) = mock(DocFormat::ShareJs, true).await;
    let mut dave = joined(&mock, "dave", &main);
    dave.comment(&main, 4, 3, T1);
    let version = mock.doc_version(&main);
    let bob = mock.peer("bob");
    assert_eq!(bob.delete_thread(&main, T1).status, 204);
    assert_eq!(mock.doc_version(&main), version);
    assert_eq!(mock.ranges(&main), json!({}));
}

#[tokio::test]
async fn module_routes_check_ids_content_and_the_message_author() {
    let (mock, main) = mock(DocFormat::ShareJs, true).await;
    let alice = mock.peer("alice");
    let bob = mock.peer("bob");
    assert_eq!(alice.post_message("not-an-object-id", "Hi").status, 400);
    assert_eq!(alice.post_message(T1, "").status, 400);
    assert_eq!(
        alice.post_message(T1, &"x".repeat(10 * 1024 + 1)).status,
        400
    );
    let id = alice.post_message(T1, "Hi").body["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(bob.edit_message(T1, &id, "Mine").status, 403);
    assert_eq!(bob.delete_message(T1, &id, true).status, 403);
    assert_eq!(
        bob.edit_message(T1, "5f00000000000000000000ff", "x").status,
        404
    );
    assert_eq!(bob.delete_message(T1, &id, false).status, 204);
    assert_eq!(alice.accept(&main, &[]).status, 400);
    assert_eq!(alice.set_track_changes(json!({})).status, 400);
    assert_eq!(alice.resolve("5f00000000000000000000ff", T1).status, 404);
    let (community, main) = self::mock(DocFormat::ShareJs, false).await;
    let alice = community.peer("alice");
    for status in [
        alice.rest("GET", "/threads", None).status,
        alice.post_message(T1, "Hi").status,
        alice.resolve(&main, T1).status,
        alice
            .set_track_changes(json!({ "on_for_guests": true }))
            .status,
    ] {
        assert_eq!(status, 404);
    }
}

#[tokio::test]
async fn every_review_route_is_absent_without_the_module_like_ce() {
    let recorded = probe("review-routes-absent");
    let steps = recorded["steps"].as_array().unwrap();
    for (format, name) in [
        (DocFormat::ShareJs, "sharejs-project"),
        (DocFormat::HistoryOt, "history-ot-project"),
    ] {
        let (mock, main) = mock(format, false).await;
        let page = steps
            .iter()
            .find(|step| step["page"]["project"] == name && step["page"]["user"] == "alice")
            .unwrap();
        let ce_project = page["page"]["route"]
            .as_str()
            .unwrap()
            .rsplit('/')
            .next()
            .unwrap()
            .to_string();
        let meta = page_meta(&mock).await;
        let ce_meta = &page["page"]["meta"];
        let capabilities: Value = serde_json::from_str(&meta["ol-capabilities"]).unwrap();
        assert_eq!(capabilities, ce_meta["ol-capabilities"]["value"], "{name}");
        assert_eq!(
            json!(meta.contains_key("ol-hasTrackChangesFeature")),
            ce_meta["ol-hasTrackChangesFeature"]["contentAttribute"],
            "{name}"
        );
        let prefix = format!("/project/{ce_project}/");
        let asked: Vec<&Value> = steps
            .iter()
            .filter(|step| {
                step.pointer("/request/route")
                    .and_then(Value::as_str)
                    .is_some_and(|route| route.starts_with(&prefix))
            })
            .collect();
        assert_eq!(asked.len(), 22, "{name}");
        for step in asked {
            let request = &step["request"];
            let route = request["route"].as_str().unwrap();
            let rest: Vec<&str> = route[prefix.len()..].split('/').collect();
            let rest: Vec<String> = rest
                .iter()
                .enumerate()
                .map(|(at, part)| {
                    if at > 0 && rest[at - 1] == "doc" {
                        main.clone()
                    } else {
                        (*part).to_string()
                    }
                })
                .collect();
            let path = format!(
                "{}/project/{}/{}",
                mock.base,
                mock.project_id(),
                rest.join("/")
            );
            let user = request["user"].as_str().unwrap();
            let mut sent = reqwest::Client::new()
                .request(request["method"].as_str().unwrap().parse().unwrap(), &path)
                .header("Cookie", mock.user(user).cookie())
                .json(&json!({}));
            if request["withoutToken"] != json!(true) {
                sent = sent.header("X-Csrf-Token", MOCK_CSRF);
            }
            let reply = sent.send().await.unwrap();
            assert_eq!(
                reply.status().as_u16(),
                step["status"],
                "{name} {user} {route}"
            );
            if step["status"] == 403 || step["status"] == 200 {
                let text = reply.text().await.unwrap();
                let body = serde_json::from_str(&text).unwrap_or(Value::String(text));
                assert_eq!(body, step["body"], "{name} {user} {route}");
            }
        }
    }
}
