use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use serde_json::json;

use super::{within, DeleteAs, ProjectRest, RestError, ReviewError, TrackChangesUpdate};
use crate::client::Http;
use crate::live::tree_queue::MAX_UPLOAD_BYTES;
use crate::realtime::events::{DocId, EntityId};
use crate::realtime::ProjectPage;
use crate::session::{Session, SessionHandle};
use crate::test_support::mock_overleaf::{
    DocFormat, Fault, MockOverleaf, MockProject, MockUser, Privilege,
};

const PROJECT: &str = "64f0c0ffee0123456789abcd";
const PATIENCE: Duration = Duration::from_secs(30);

async fn read_request(stream: &mut TcpStream) {
    let mut seen = Vec::new();
    let mut buffer = [0_u8; 1024];
    while !seen.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(read) => seen.extend_from_slice(&buffer[..read]),
        }
    }
}

async fn serve(
    head: &'static str,
    body: impl Fn(u64) -> Option<Vec<u8>> + Send + 'static,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        read_request(&mut stream).await;
        if stream.write_all(head.as_bytes()).await.is_err() {
            return;
        }
        let mut round = 0;
        while let Some(bytes) = body(round) {
            if stream.write_all(&bytes).await.is_err() {
                return;
            }
            round += 1;
        }
        tokio::time::sleep(PATIENCE * 2).await;
    });
    base
}

async fn download(base: &str) -> Result<Vec<u8>, RestError> {
    let http = Http::new(base, "Oleafly/test").unwrap();
    let page = Arc::new(ProjectPage::unloaded(PROJECT).unwrap());
    let rest = ProjectRest::new(http, page, PROJECT);
    let session = SessionHandle::new(
        base,
        Session {
            cookie: "overleaf_session2=s%3Atest".into(),
            user_id: "alice".into(),
            email: "alice@example.com".into(),
            saved_by: None,
        },
        None,
    );
    let mut seen = 0;
    let mut progress = |done: u64, _: Option<u64>| seen = done;
    let file = EntityId("f1".into());
    let fetched = rest.download(&session, &file, None, &mut progress);
    let result = tokio::time::timeout(PATIENCE, fetched)
        .await
        .expect("the download gave up instead of reading forever");
    assert!(seen <= MAX_UPLOAD_BYTES, "{seen} bytes were kept");
    result
}

#[tokio::test]
async fn a_declared_length_over_the_cap_is_refused_before_reading() {
    let base = serve(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 9223372036854775808\r\n\r\n",
        |round| (round == 0).then(|| b"PNG".to_vec()),
    )
    .await;
    assert_eq!(download(&base).await, Err(RestError::TooLarge));
}

#[tokio::test]
async fn a_chunked_body_that_never_ends_stops_at_the_cap() {
    let base = serve(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
        |_| {
            let mut chunk = b"10000\r\n".to_vec();
            chunk.extend(std::iter::repeat_n(b'x', 0x10000));
            chunk.extend_from_slice(b"\r\n");
            Some(chunk)
        },
    )
    .await;
    assert_eq!(download(&base).await, Err(RestError::TooLarge));
}

const T1: &str = "5f00000000000000000000a1";
const T2: &str = "5f00000000000000000000a2";

fn review_project() -> MockProject {
    MockProject::new("Review")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("erin"))
        .doc("main.tex", "One two three four")
        .doc("notes.tex", "Some notes here")
}

async fn reviewing(review: bool) -> MockOverleaf {
    let mock = MockOverleaf::start(review_project()).await;
    mock.configure(|config| config.review = review);
    mock.set_doc_format(&mock.doc_id("notes.tex"), DocFormat::HistoryOt);
    mock
}

pub(super) async fn rest_for(mock: &MockOverleaf, name: &str) -> (ProjectRest, SessionHandle) {
    let user = mock.user(name);
    let http = Http::new(&mock.base, "Oleafly/test").unwrap();
    let session = SessionHandle::new(
        &mock.base,
        Session {
            cookie: user.cookie(),
            user_id: user.id.clone(),
            email: user.email.clone(),
            saved_by: None,
        },
        None,
    );
    let page = ProjectPage::load(&http, &session, &mock.project_id(), false)
        .await
        .unwrap();
    let rest = ProjectRest::new(http, Arc::new(page), &mock.project_id());
    (rest, session)
}

pub(super) async fn until_sent<T>(
    mock: &MockOverleaf,
    route: &str,
    call: &tokio::task::JoinHandle<T>,
) {
    while mock.requests(route).is_empty() && !call.is_finished() {
        tokio::task::yield_now().await;
    }
}

fn doc(mock: &MockOverleaf, path: &str) -> DocId {
    DocId(mock.doc_id(path))
}

#[tokio::test]
async fn every_review_route_is_absent_on_a_server_without_the_module() {
    let mock = reviewing(false).await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let main = doc(&mock, "main.tex");
    assert_eq!(rest.threads(&alice).await, Err(ReviewError::Absent));
    assert_eq!(
        rest.post_message(&alice, T1, "Hi").await,
        Err(ReviewError::Absent)
    );
    assert_eq!(
        rest.edit_message(&alice, T1, T2, "Hi").await,
        Err(ReviewError::Absent)
    );
    for by in [DeleteAs::Author, DeleteAs::Moderator] {
        assert_eq!(
            rest.delete_message(&alice, T1, T2, by).await,
            Err(ReviewError::Absent)
        );
    }
    assert_eq!(
        rest.resolve_thread(&alice, &main, T1).await,
        Err(ReviewError::Absent)
    );
    assert_eq!(
        rest.reopen_thread(&alice, &main, T1).await,
        Err(ReviewError::Absent)
    );
    assert_eq!(
        rest.delete_thread(&alice, &main, T1).await,
        Err(ReviewError::Absent)
    );
    assert_eq!(
        rest.accept_changes(&alice, &main, &["c1".into()]).await,
        Err(ReviewError::Absent)
    );
    let update = TrackChangesUpdate::Guests(true);
    assert_eq!(
        rest.set_track_changes(&alice, &update).await,
        Err(ReviewError::Absent)
    );
    let project = mock.project_id();
    let deletes = |kind: &str| {
        mock.requests(&format!("/project/{project}/thread/{T1}/{kind}/{T2}"))
            .iter()
            .filter(|request| request.method == "DELETE")
            .count()
    };
    assert_eq!((deletes("own-messages"), deletes("messages")), (1, 2));
}

#[tokio::test]
async fn threads_messages_and_resolution_go_through_the_module() {
    let mock = reviewing(true).await;
    let main = doc(&mock, "main.tex");
    let (rest, alice) = rest_for(&mock, "alice").await;
    let (bob_rest, bob) = rest_for(&mock, "bob").await;
    let mut watcher = mock.peer("dave");
    assert_eq!(rest.threads(&alice).await, Ok(Vec::new()));
    let first = rest
        .post_message(&alice, T1, "Look @[x]")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.content, "Look @[x]");
    assert_eq!(
        first.user_id.as_deref(),
        Some(mock.user("alice").id.as_str())
    );
    let reply = bob_rest
        .post_message(&bob, T1, "Done")
        .await
        .unwrap()
        .unwrap();
    let threads = rest.threads(&alice).await.unwrap();
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].id, T1);
    let names: Vec<Option<&str>> = threads[0]
        .messages
        .iter()
        .map(|message| {
            message
                .user
                .as_ref()
                .and_then(|user| user.first_name.as_deref())
        })
        .collect();
    assert_eq!(names, vec![Some("Alice"), Some("Bob")]);
    rest.edit_message(&alice, T1, &first.id, "Look again")
        .await
        .unwrap();
    assert_eq!(
        bob_rest.edit_message(&bob, T1, &first.id, "Mine now").await,
        Err(ReviewError::Rest(RestError::NotAllowed))
    );
    rest.resolve_thread(&alice, &main, T1).await.unwrap();
    let resolved = rest.threads(&alice).await.unwrap().remove(0);
    let resolution = resolved.resolved.unwrap();
    assert_eq!(
        resolution.by.map(|user| user.id),
        Some(mock.user("alice").id)
    );
    assert!(resolution.at.is_some());
    assert_eq!(resolved.messages[0].content, "Look again");
    assert!(resolved.messages[0].edited_at.is_some());
    rest.reopen_thread(&alice, &main, T1).await.unwrap();
    bob_rest
        .delete_message(&bob, T1, &reply.id, DeleteAs::Author)
        .await
        .unwrap();
    assert_eq!(rest.threads(&alice).await.unwrap()[0].messages.len(), 1);
    rest.delete_thread(&alice, &main, T1).await.unwrap();
    assert_eq!(rest.threads(&alice).await, Ok(Vec::new()));
    let seen: Vec<usize> = [
        "new-comment",
        "edit-message",
        "resolve-thread",
        "reopen-thread",
        "delete-message",
        "delete-thread",
    ]
    .iter()
    .map(|name| watcher.events(name).len())
    .collect();
    assert_eq!(seen, vec![2, 1, 1, 1, 1, 1]);
}

fn denied<T>(result: Result<T, ReviewError>) -> bool {
    matches!(result, Err(ReviewError::Rest(RestError::NotAllowed)))
}

#[tokio::test]
async fn review_permissions_follow_each_role() {
    let mock = reviewing(true).await;
    let main = doc(&mock, "main.tex");
    let (rest, alice) = rest_for(&mock, "alice").await;
    let (carol_rest, carol) = rest_for(&mock, "carol").await;
    let (dave_rest, dave) = rest_for(&mock, "dave").await;
    let (erin_rest, erin) = rest_for(&mock, "erin").await;
    let (bob_rest, bob) = rest_for(&mock, "bob").await;
    rest.post_message(&alice, T1, "Owner thread").await.unwrap();
    carol_rest
        .post_message(&carol, T2, "Reviewer thread")
        .await
        .unwrap();
    dave_rest
        .post_message(&dave, T1, "Viewer reply")
        .await
        .unwrap();
    assert!(denied(erin_rest.threads(&erin).await));
    assert!(denied(erin_rest.post_message(&erin, T1, "Guest").await));
    assert!(denied(carol_rest.resolve_thread(&carol, &main, T1).await));
    carol_rest.resolve_thread(&carol, &main, T2).await.unwrap();
    assert!(denied(dave_rest.resolve_thread(&dave, &main, T1).await));
    let dave_message = rest.threads(&alice).await.unwrap()[0].messages[1]
        .id
        .clone();
    assert!(denied(
        carol_rest
            .delete_message(&carol, T1, &dave_message, DeleteAs::Moderator)
            .await
    ));
    assert!(denied(
        carol_rest
            .delete_message(&carol, T1, &dave_message, DeleteAs::Author)
            .await
    ));
    rest.delete_message(&alice, T1, &dave_message, DeleteAs::Moderator)
        .await
        .unwrap();
    assert!(denied(
        carol_rest
            .accept_changes(&carol, &main, &["c1".into()])
            .await
    ));
    let carol_id = mock.user("carol").id;
    let bob_id = mock.user("bob").id;
    let me = TrackChangesUpdate::Members([(bob_id.clone(), true)].into_iter().collect());
    assert!(denied(carol_rest.set_track_changes(&carol, &me).await));
    bob_rest.set_track_changes(&bob, &me).await.unwrap();
    let others = TrackChangesUpdate::Members(
        [(bob_id.clone(), true), (carol_id.clone(), true)]
            .into_iter()
            .collect(),
    );
    assert!(denied(bob_rest.set_track_changes(&bob, &others).await));
    assert!(denied(
        bob_rest
            .set_track_changes(&bob, &TrackChangesUpdate::Guests(true))
            .await
    ));
    rest.set_track_changes(&alice, &others).await.unwrap();
    rest.set_track_changes(&alice, &TrackChangesUpdate::Guests(true))
        .await
        .unwrap();
}

#[tokio::test]
async fn deleting_your_own_message_falls_back_to_the_older_route() {
    let mock = reviewing(true).await;
    let (rest, bob) = rest_for(&mock, "bob").await;
    let message = rest.post_message(&bob, T1, "Typo").await.unwrap().unwrap();
    let project = mock.project_id();
    let own = format!("/project/{project}/thread/{T1}/own-messages/{}", message.id);
    mock.plan_fault(Some("DELETE"), &own, Fault::Reply(404, "Not Found".into()));
    rest.delete_message(&bob, T1, &message.id, DeleteAs::Author)
        .await
        .unwrap();
    let older = format!("/project/{project}/thread/{T1}/messages/{}", message.id);
    assert_eq!(mock.requests(&own).len(), 1);
    assert_eq!(mock.requests(&older).len(), 1);
    assert_eq!(rest.threads(&bob).await, Ok(Vec::new()));
}

#[tokio::test]
async fn accepting_changes_removes_them_and_tells_the_room() {
    let mock = reviewing(true).await;
    let main = doc(&mock, "main.tex");
    let notes = doc(&mock, "notes.tex");
    let mut carol = mock.peer("carol");
    carol.join(&main.0);
    carol.track_insert(&main.0, 3, " and");
    let ranges = mock.ranges(&main.0);
    let id = ranges["changes"][0]["id"].as_str().unwrap().to_string();
    let (rest, alice) = rest_for(&mock, "alice").await;
    rest.accept_changes(&alice, &main, std::slice::from_ref(&id))
        .await
        .unwrap();
    assert_eq!(mock.ranges(&main.0), json!({}));
    assert_eq!(
        carol.events("accept-changes"),
        vec![vec![json!(main.0), json!([id])]]
    );
    assert!(matches!(
        rest.accept_changes(&alice, &notes, &["c1".into()]).await,
        Err(ReviewError::Rest(RestError::Refused { status: 422, .. }))
    ));
}

#[tokio::test]
async fn a_review_request_with_a_bad_id_or_message_never_leaves() {
    let mock = reviewing(true).await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let main = doc(&mock, "main.tex");
    let long = "x".repeat(10 * 1024 + 1);
    for result in [
        rest.post_message(&alice, "../threads", "Hi")
            .await
            .map(drop),
        rest.post_message(&alice, T1, "").await.map(drop),
        rest.post_message(&alice, T1, &long).await.map(drop),
        rest.edit_message(&alice, T1, "a/b", "Hi").await,
        rest.resolve_thread(&alice, &DocId("..".into()), T1).await,
        rest.accept_changes(&alice, &main, &[]).await,
        rest.accept_changes(&alice, &main, &["c 1".into()]).await,
        rest.set_track_changes(
            &alice,
            &TrackChangesUpdate::Members([("x/y".to_string(), true)].into_iter().collect()),
        )
        .await,
    ] {
        assert!(matches!(result, Err(ReviewError::Invalid(_))), "{result:?}");
    }
    let project = mock.project_id();
    assert!(mock
        .requests(&format!("/project/{project}/thread"))
        .is_empty());
    assert!(mock.requests(&format!("/project/{project}/doc")).is_empty());
    assert!(mock
        .requests(&format!("/project/{project}/track_changes"))
        .is_empty());
    rest.post_message(&alice, T1, &"x".repeat(10 * 1024))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_review_call_gives_up_at_its_deadline() {
    let mock = reviewing(true).await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let threads = format!("/project/{}/threads", mock.project_id());
    mock.plan_fault(Some("GET"), &threads, Fault::Delay(Duration::from_secs(5)));
    let limit = Duration::from_millis(100);
    assert_eq!(
        within(limit, ReviewError::TimedOut, rest.threads(&alice)).await,
        Err(ReviewError::TimedOut(limit))
    );
    assert!(ReviewError::TimedOut(limit).is_temporary());
    assert!(!ReviewError::Absent.is_temporary());
    assert_eq!(
        within(
            Duration::from_secs(5),
            ReviewError::TimedOut,
            rest.threads(&alice)
        )
        .await,
        Ok(Vec::new())
    );
}

#[tokio::test]
async fn an_oversized_threads_reply_is_refused_before_reading() {
    let base = serve(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 9223372036854775808\r\n\r\n",
        |round| (round == 0).then(|| b"{}".to_vec()),
    )
    .await;
    let http = Http::new(&base, "Oleafly/test").unwrap();
    let page = Arc::new(ProjectPage::unloaded(PROJECT).unwrap());
    let rest = ProjectRest::new(http, page, PROJECT);
    let session = SessionHandle::new(
        &base,
        Session {
            cookie: "overleaf_session2=s%3Atest".into(),
            user_id: "alice".into(),
            email: "alice@example.com".into(),
            saved_by: None,
        },
        None,
    );
    let read = tokio::time::timeout(PATIENCE, rest.threads(&session))
        .await
        .expect("the reply was read without a cap");
    assert!(
        matches!(&read, Err(ReviewError::Rest(RestError::Unreadable(detail))) if detail.contains("larger than")),
        "{read:?}"
    );
}

#[tokio::test]
async fn an_endless_refusal_is_read_capped() {
    let chunk = vec![b'x'; 64 * 1024];
    let base = serve(
        "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\n",
        move |_| Some(chunk.clone()),
    )
    .await;
    let http = Http::new(&base, "Oleafly/test").unwrap();
    let page = Arc::new(ProjectPage::unloaded(PROJECT).unwrap());
    let rest = ProjectRest::new(http, page, PROJECT);
    let session = SessionHandle::new(
        &base,
        Session {
            cookie: "overleaf_session2=s%3Atest".into(),
            user_id: "alice".into(),
            email: "alice@example.com".into(),
            saved_by: None,
        },
        None,
    );
    let read = tokio::time::timeout(PATIENCE, rest.entities(&session))
        .await
        .expect("the refusal was read without a cap");
    assert!(
        matches!(&read, Err(RestError::Refused { status: 404, message }) if message.len() <= 200),
        "{read:?}"
    );
}
