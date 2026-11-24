use std::time::Duration;

use super::super::tests::rest_for;
use super::super::{within, RestError, ReviewError, CHAT_PAGE_LIMIT};
use crate::realtime::project::Role;
use crate::test_support::mock_overleaf::{Fault, MockOverleaf, MockProject, MockUser, Privilege};

const CLIENT: &str = "3f1c6f0e-1d8e-4d2a-9b71-0f1b7f0c2a11";

fn chat_project() -> MockProject {
    MockProject::new("Chat")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("erin"))
        .doc("main.tex", "Hello")
}

#[tokio::test]
async fn chat_posts_pages_edits_and_deletes_through_the_project_routes() {
    let mock = MockOverleaf::start(chat_project()).await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let (_, dave) = rest_for(&mock, "dave").await;
    for n in 1..=3 {
        rest.post_chat(&alice, &format!("m{n}"), CLIENT)
            .await
            .unwrap();
    }
    rest.post_chat(&dave, "a viewer chats", CLIENT)
        .await
        .unwrap();
    let newest = rest.chat_messages(&alice, None, 2).await.unwrap();
    let names: Vec<&str> = newest
        .iter()
        .map(|message| message.content.as_str())
        .collect();
    assert_eq!(names, ["a viewer chats", "m3"]);
    assert_eq!(
        newest[0]
            .user
            .as_ref()
            .and_then(|user| user.first_name.as_deref()),
        Some("Dave")
    );
    let older = rest
        .chat_messages(&alice, newest[1].timestamp, CHAT_PAGE_LIMIT + 5)
        .await
        .unwrap();
    let names: Vec<&str> = older
        .iter()
        .map(|message| message.content.as_str())
        .collect();
    assert_eq!(names, ["m2", "m1"]);
    let first = older[1].id.clone();
    rest.edit_chat(&alice, &first, "m1 edited").await.unwrap();
    assert_eq!(
        rest.edit_chat(&dave, &first, "not mine").await,
        Err(ReviewError::Rest(RestError::NotAllowed))
    );
    assert_eq!(
        rest.delete_chat(&dave, &first).await,
        Err(ReviewError::Rest(RestError::NotAllowed))
    );
    rest.delete_chat(&alice, &first).await.unwrap();
    assert!(matches!(
        rest.delete_chat(&alice, &first).await,
        Err(ReviewError::Rest(RestError::Unreachable(_)))
    ));
    let left = rest.chat_messages(&alice, None, 10).await.unwrap();
    assert!(left.iter().all(|message| message.id != first));
    assert_eq!(mock.chat_messages().as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn a_chat_request_with_a_bad_id_or_message_never_leaves() {
    let mock = MockOverleaf::start(chat_project()).await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let long = "x".repeat(10 * 1024 + 1);
    for result in [
        rest.post_chat(&alice, "", CLIENT).await,
        rest.post_chat(&alice, &long, CLIENT).await,
        rest.edit_chat(&alice, "../messages", "Hi").await,
        rest.edit_chat(&alice, "m1", "").await,
        rest.delete_chat(&alice, "a/b").await,
    ] {
        assert!(matches!(result, Err(ReviewError::Invalid(_))), "{result:?}");
    }
    assert!(mock
        .requests(&format!("/project/{}/messages", mock.project_id()))
        .is_empty());
}

#[tokio::test]
async fn chat_is_absent_when_the_server_has_it_off_and_refused_to_link_viewers() {
    let mock = MockOverleaf::start(chat_project()).await;
    let (_, erin) = rest_for(&mock, "erin").await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    assert_eq!(
        rest.chat_messages(&erin, None, 10).await,
        Err(ReviewError::Rest(RestError::NotAllowed))
    );
    mock.configure(|config| config.chat = false);
    assert_eq!(
        rest.chat_messages(&alice, None, 10).await,
        Err(ReviewError::Absent)
    );
    assert_eq!(
        rest.post_chat(&alice, "hi", CLIENT).await,
        Err(ReviewError::Absent)
    );
}

#[tokio::test]
async fn a_chat_page_gives_up_at_its_deadline() {
    let mock = MockOverleaf::start(chat_project()).await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let route = format!("/project/{}/messages", mock.project_id());
    mock.plan_fault(Some("GET"), &route, Fault::Delay(Duration::from_secs(5)));
    let limit = Duration::from_millis(100);
    assert_eq!(
        within(
            limit,
            ReviewError::TimedOut,
            rest.chat_messages(&alice, None, 10)
        )
        .await,
        Err(ReviewError::TimedOut(limit))
    );
}

#[tokio::test]
async fn invites_are_read_by_the_owner_and_change_authors_need_the_module() {
    let mock = MockOverleaf::start(chat_project()).await;
    let invite = mock.invite("newcomer@uni.edu", Privilege::Review);
    let (rest, alice) = rest_for(&mock, "alice").await;
    let (_, bob) = rest_for(&mock, "bob").await;
    let invites = rest.invites(&alice).await.unwrap();
    assert_eq!(invites.len(), 1);
    assert_eq!(
        (
            invites[0].id.as_str(),
            invites[0].email.as_str(),
            invites[0].role
        ),
        (invite.as_str(), "newcomer@uni.edu", Role::Reviewer)
    );
    assert_eq!(
        rest.invites(&bob).await,
        Err(ReviewError::Rest(RestError::NotAllowed))
    );
    assert_eq!(rest.changes_users(&alice).await, Err(ReviewError::Absent));
    mock.configure(|config| config.review = true);
    assert_eq!(rest.changes_users(&alice).await, Ok(Vec::new()));
}
