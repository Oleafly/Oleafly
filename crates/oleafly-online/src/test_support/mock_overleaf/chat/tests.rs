use serde_json::{json, Value};

use super::super::{MockOverleaf, MockProject, MockUser, Privilege};
use crate::html;
use crate::test_support::overleaf_rt::probe_steps;

const CLIENT: &str = "3f1c6f0e-1d8e-4d2a-9b71-0f1b7f0c2a11";

fn project() -> MockProject {
    MockProject::new("Chat")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("erin"))
        .doc("main.tex", "Hello")
}

async fn capabilities(mock: &MockOverleaf) -> Option<Vec<String>> {
    let page = reqwest::Client::new()
        .get(mock.project_page_url())
        .header("Cookie", mock.user("alice").cookie())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let tags = html::meta_tags(&page);
    serde_json::from_str(tags.get("ol-capabilities")?).ok()
}

fn contents(page: &Value) -> Vec<&str> {
    page.as_array()
        .unwrap()
        .iter()
        .map(|message| message["content"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn a_post_answers_204_and_every_member_but_a_link_viewer_hears_one_object() {
    let mock = MockOverleaf::start(project()).await;
    assert_eq!(
        capabilities(&mock).await,
        Some(vec!["chat".to_string(), "link-sharing".to_string()])
    );
    let mut alice = mock.peer("alice");
    let mut bob = mock.peer("bob");
    let mut erin = mock.peer("erin");
    let posted = bob.post_chat("Hello $x^2$", Some(CLIENT));
    assert_eq!((posted.status, posted.body.clone()), (204, json!("")));
    for peer in [&mut alice, &mut bob] {
        let heard = peer.take_events("new-chat-message");
        assert_eq!(heard.len(), 1);
        assert_eq!(heard[0].len(), 1);
        let message = &heard[0][0];
        assert_eq!(message["content"], "Hello $x^2$");
        assert_eq!(message["clientId"], CLIENT);
        assert_eq!(message["user_id"], mock.user("bob").id);
        assert_eq!(message["user"]["first_name"], "Bob");
        assert_eq!(message["room_id"], mock.project_id());
        assert!(message["timestamp"].as_u64().is_some());
    }
    assert!(erin.take_events("new-chat-message").is_empty());
    assert_eq!(erin.post_chat("hi", None).status, 403);
    assert_eq!(erin.chat_page(None, 10).status, 403);
    let dave = mock.peer("dave");
    assert_eq!(dave.post_chat("A viewer may chat", None).status, 204);
    let heard = alice.take_events("new-chat-message");
    assert!(heard[0][0].get("clientId").is_none());
    assert_eq!(bob.post_chat("", None).status, 400);
    assert_eq!(bob.post_chat(&"x".repeat(10 * 1024 + 1), None).status, 400);
}

#[tokio::test]
async fn pages_come_newest_first_and_before_is_exclusive() {
    let mock = MockOverleaf::start(project()).await;
    let alice = mock.peer("alice");
    for n in 1..=5 {
        assert_eq!(alice.post_chat(&format!("m{n}"), None).status, 204);
    }
    let all = alice.chat_page(None, 50).body;
    assert_eq!(contents(&all), ["m5", "m4", "m3", "m2", "m1"]);
    let newest = alice.chat_page(None, 2).body;
    assert_eq!(contents(&newest), ["m5", "m4"]);
    let before = newest[1]["timestamp"].as_u64().unwrap();
    let older = alice.chat_page(Some(before), 2).body;
    assert_eq!(contents(&older), ["m3", "m2"]);
    let last = alice
        .chat_page(Some(older[1]["timestamp"].as_u64().unwrap()), 2)
        .body;
    assert_eq!(contents(&last), ["m1"]);
}

#[tokio::test]
async fn only_the_author_edits_or_deletes_and_a_delete_is_hard() {
    let mock = MockOverleaf::start(project()).await;
    let mut alice = mock.peer("alice");
    let bob = mock.peer("bob");
    bob.post_chat("Bob says", None);
    let id = mock.chat_messages()[0]["id"].as_str().unwrap().to_string();
    alice.take_events("new-chat-message");
    assert_eq!(alice.edit_chat(&id, "Alice edits").status, 403);
    assert_eq!(alice.delete_chat(&id).status, 403);
    assert_eq!(bob.edit_chat(&id, "").status, 500);
    assert_eq!(bob.edit_chat(&id, "Bob edits").status, 204);
    assert_eq!(
        alice.take_events("edit-global-message"),
        vec![vec![
            json!({ "messageId": id, "userId": mock.user("bob").id, "content": "Bob edits" })
        ]]
    );
    let listed = bob.chat_page(None, 10).body;
    assert_eq!(listed[0]["content"], "Bob edits");
    assert!(listed[0]["edited_at"].as_u64().is_some());
    assert_eq!(bob.delete_chat(&id).status, 204);
    assert_eq!(
        alice.take_events("delete-global-message"),
        vec![vec![
            json!({ "messageId": id, "userId": mock.user("bob").id })
        ]]
    );
    assert_eq!(bob.chat_page(None, 10).body, json!([]));
    assert_eq!(bob.delete_chat(&id).status, 500);
}

#[tokio::test]
async fn chat_off_answers_404_and_leaves_chat_out_of_the_page() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.chat = false);
    assert_eq!(
        capabilities(&mock).await,
        Some(vec!["link-sharing".to_string()])
    );
    let alice = mock.peer("alice");
    assert_eq!(alice.post_chat("hi", None).status, 404);
    assert_eq!(alice.chat_page(None, 1).status, 404);
}

#[tokio::test]
async fn invites_come_with_the_join_and_the_owner_route_and_change_authors_need_the_module() {
    let mock = MockOverleaf::start(project()).await;
    let mut alice = mock.peer("alice");
    let invite = mock.invite("newcomer@uni.edu", Privilege::ReadOnly);
    assert_eq!(
        alice.take_events("project:membership:changed"),
        vec![vec![json!({ "invites": true })]]
    );
    let listed = alice.rest("GET", "/invites", None);
    assert_eq!(
        listed.body["invites"],
        json!([{ "_id": invite, "email": "newcomer@uni.edu", "privileges": "readOnly" }])
    );
    assert_eq!(mock.peer("bob").rest("GET", "/invites", None).status, 403);
    let mut carol = mock.peer("bob");
    let join = &carol.events("joinProjectResponse")[0][0];
    assert_eq!(join["project"]["invites"][0]["email"], "newcomer@uni.edu");
    let mut erin = mock.peer("erin");
    let restricted = &erin.events("joinProjectResponse")[0][0];
    assert_eq!(restricted["project"]["invites"], json!([]));
    assert_eq!(alice.rest("GET", "/changes/users", None).status, 404);
    mock.configure(|config| config.review = true);
    let main = mock.doc_id("main.tex");
    let mut bob = mock.peer("bob");
    bob.join(&main);
    bob.track_insert(&main, 0, "Oh ");
    let authors = alice.rest("GET", "/changes/users", None).body;
    assert_eq!(authors[0]["id"], mock.user("bob").id);
    assert_eq!(authors[0]["first_name"], "Bob");
}

#[tokio::test]
async fn a_burst_of_messages_meets_the_rate_limit_like_ce() {
    let ce = probe_steps("chat-rate-limit", |step| step.get("attempt").is_some()).swap_remove(0);
    let refused_at = ce["attempt"].as_u64().unwrap();
    let mock = MockOverleaf::start(project()).await;
    let alice = mock.peer("alice");
    for sent in 1..refused_at {
        assert_eq!(alice.post_chat(&format!("Burst {sent}"), None).status, 204);
    }
    let refused = alice.post_chat(ce["request"]["body"]["content"].as_str().unwrap(), None);
    assert_eq!(refused.status, ce["status"]);
    assert_eq!(refused.body, ce["body"]);
    assert_eq!(
        mock.peer("bob")
            .post_chat("Bob may still talk", None)
            .status,
        204
    );
}
