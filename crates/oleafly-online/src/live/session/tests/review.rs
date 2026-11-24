use std::sync::Arc;
use std::time::{Duration, Instant};

use oleafly_ot::testing::EditorDoc;
use serde_json::{json, Value};

use super::super::state::State;
use super::super::{ModeLock, OverleafSession, ReviewWriteError, SessionTuning, TrackScope};
use super::{eventually, tuning, watcher, Port, Rig, Tab, MAIN, WAIT};
use crate::live::doc::Origin;
use crate::live::format::{ChangeKind, Decision, DocFormat};
use crate::live::DocId;
use crate::realtime::events::{ReviewEvent, Thread, ThreadMessage};
use crate::realtime::project::Role;
use crate::test_support::mock_overleaf::{
    DocFormat as MockFormat, Fault, MockProject, MockUser, Privilege,
};

const TEXT: &str = "Hello world\n";
const T1: &str = "6b04e5f6c0ffee0010000001";
const T2: &str = "6b04e5f6c0ffee0011000001";

fn review_project(format: MockFormat) -> MockProject {
    MockProject::new("review")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("tess"))
        .format(format)
        .doc(MAIN, TEXT)
}

async fn review_rig(format: MockFormat, review: bool) -> Rig {
    let rig = Rig::start(review_project(format)).await;
    rig.mock.configure(|config| config.review = review);
    rig
}

async fn go_live(rig: &Rig, name: &str, port: &Arc<Port>) -> (Arc<OverleafSession>, Tab) {
    go_live_tuned(rig, name, port, tuning()).await
}

async fn go_live_tuned(
    rig: &Rig,
    name: &str,
    port: &Arc<Port>,
    tuned: SessionTuning,
) -> (Arc<OverleafSession>, Tab) {
    rig.seed(name, 0).await;
    let live = rig.live_tuned(name, port, tuned).await;
    let tab = Tab::open(&live, MAIN);
    let main = rig.id(MAIN);
    eventually("the doc is joined", || {
        live.review(&main).is_some() && live.review_support().probed
    })
    .await;
    (live, tab)
}

fn fresh_port() -> Arc<Port> {
    Port::new(&[(MAIN, TEXT)])
}

fn server_comment(rig: &Rig, thread: &str) -> Option<Value> {
    let main = rig.mock.doc_id(MAIN);
    let ranges = rig.mock.ranges(&main);
    let raw = rig.mock.raw_doc(&main);
    ranges["comments"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(raw["comments"].as_array().into_iter().flatten())
        .find(|comment| comment["id"] == thread)
        .cloned()
}

fn quote_of(live: &OverleafSession, doc: &DocId, thread: &str) -> Option<String> {
    live.review(doc)?
        .comments
        .into_iter()
        .find(|comment| comment.thread == thread)
        .map(|comment| comment.quote)
}

fn messages(rig: &Rig, thread: &str) -> Vec<String> {
    rig.mock.threads()[thread]["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|message| message["content"].as_str().unwrap_or_default().to_string())
        .collect()
}

fn cached(live: &OverleafSession, thread: &str) -> Vec<String> {
    live.threads()
        .threads
        .get(thread)
        .map(|thread| {
            thread
                .messages
                .iter()
                .map(|message| message.content.clone())
                .collect()
        })
        .unwrap_or_default()
}

fn change_ids(live: &OverleafSession, doc: &DocId) -> Vec<String> {
    live.review(doc)
        .map(|review| review.changes.into_iter().map(|change| change.id).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn the_review_module_is_probed_and_threads_load_after_the_join() {
    for review in [true, false] {
        let rig = review_rig(MockFormat::ShareJs, review).await;
        let bob = rig.mock.peer("bob");
        let posted = bob.post_message(T1, "Earlier");
        assert_eq!(posted.status, if review { 201 } else { 404 });
        let port = fresh_port();
        let (live, _tab) = go_live(&rig, "alice", &port).await;
        let support = live.review_support();
        assert_eq!(support.threads, review);
        assert_eq!(support.accept_rest, review);
        assert!(support.plan_allows_tracking);
        if review {
            eventually("the threads load", || live.threads().loaded).await;
            assert_eq!(cached(&live, T1), vec!["Earlier".to_string()]);
            assert!(port.seen().review.iter().any(|change| change.threads));
        } else {
            assert!(!live.threads().loaded);
            let main = rig.id(MAIN);
            assert_eq!(
                live.comment(&main, 0, 5, None, "Hi").await,
                Err(ReviewWriteError::Absent)
            );
            assert_eq!(live.edit_mode().locked, Some(ModeLock::Server));
        }
        live.stop().await;
    }
}

#[tokio::test]
async fn every_review_event_patches_only_the_thread_it_names() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.post_message(T2, "Other thread");
    let port = fresh_port();
    let (live, _tab) = go_live(&rig, "alice", &port).await;
    eventually("the threads load", || live.threads().loaded).await;
    let other = live.threads().threads.get(T2).cloned();
    let posted = bob.post_message(T1, "First");
    let first = posted.body["id"].as_str().unwrap().to_string();
    eventually("new-comment lands", || cached(&live, T1) == ["First"]).await;
    bob.edit_message(T1, &first, "First, edited");
    eventually("edit-message lands", || {
        cached(&live, T1) == ["First, edited"]
    })
    .await;
    let edited = live.threads().threads[T1].messages[0].edited_at;
    assert!(edited.is_some());
    let second = bob.post_message(T1, "Second").body["id"]
        .as_str()
        .unwrap()
        .to_string();
    eventually("the reply lands", || cached(&live, T1).len() == 2).await;
    bob.delete_message(T1, &second, true);
    eventually("delete-message lands", || cached(&live, T1).len() == 1).await;
    bob.resolve(&main.0, T1);
    eventually("resolve-thread lands", || {
        live.threads().threads[T1].resolved.is_some()
    })
    .await;
    let by = live.threads().threads[T1].resolved.clone().unwrap().by;
    assert_eq!(by.map(|user| user.id), Some(rig.user_id("bob")));
    bob.reopen(&main.0, T1);
    eventually("reopen-thread lands", || {
        live.threads().threads[T1].resolved.is_none()
    })
    .await;
    rig.mock.emit_to_room(
        "new-comment-threads",
        &[json!({ "6b04e5f6c0ffee0012000001": { "messages": [
            { "id": "6b04e5f6c0ffee0012000002", "content": "Restored", "timestamp": 5, "user_id": rig.user_id("bob") },
        ] } })],
    );
    eventually("new-comment-threads merges", || {
        cached(&live, "6b04e5f6c0ffee0012000001") == ["Restored"]
    })
    .await;
    bob.comment(&main.0, 0, 5, T1);
    eventually("the anchor arrives", || {
        quote_of(&live, &main, T1).as_deref() == Some("Hello")
    })
    .await;
    assert_eq!(live.threads().anchored.get(T1), Some(&main));
    bob.delete_thread(&main.0, T1);
    eventually("delete-thread removes the thread and its anchor", || {
        !live.threads().threads.contains_key(T1) && quote_of(&live, &main, T1).is_none()
    })
    .await;
    assert_eq!(live.threads().threads.get(T2).cloned(), other);
    bob.track_insert(&main.0, 6, "brave ");
    eventually("the suggestion arrives", || {
        change_ids(&live, &main).len() == 1
    })
    .await;
    let ids = change_ids(&live, &main);
    assert_eq!(bob.accept(&main.0, &ids).status, 204);
    eventually("accept-changes removes it", || {
        change_ids(&live, &main).is_empty()
    })
    .await;
    {
        let seen = port.seen();
        assert!(seen.review.iter().any(|change| change.docs.contains(&main)));
        assert!(seen.review.iter().all(|change| change.trouble.is_none()));
    }
    live.stop().await;
}

#[tokio::test]
async fn a_comment_posts_its_first_message_then_anchors_it_in_both_formats() {
    for format in [MockFormat::ShareJs, MockFormat::HistoryOt] {
        let rig = review_rig(format, true).await;
        let main = rig.id(MAIN);
        let port = fresh_port();
        let (live, mut tab) = go_live(&rig, "alice", &port).await;
        tab.pump(&live);
        let rev = tab.editor.server_rev;
        assert_eq!(
            live.comment(&main, 0, 5, Some(rev + 7), "Look").await,
            Err(ReviewWriteError::Stale)
        );
        assert_eq!(
            live.comment(&main, 3, 99, None, "Look").await,
            Err(ReviewWriteError::Invalid("a selection outside the text"))
        );
        let made = live.comment(&main, 0, 5, Some(rev), "Look").await.unwrap();
        assert_eq!(made.thread.len(), 24);
        assert_eq!(messages(&rig, &made.thread), vec!["Look".to_string()]);
        assert_eq!(cached(&live, &made.thread), vec!["Look".to_string()]);
        assert!(live.settle(WAIT).await);
        eventually("the anchor reaches the server", || {
            server_comment(&rig, &made.thread).is_some()
        })
        .await;
        assert_eq!(
            quote_of(&live, &main, &made.thread).as_deref(),
            Some("Hello"),
            "{format:?}"
        );
        assert_eq!(live.threads().anchored.get(&made.thread), Some(&main));
        let review = live.review(&main).unwrap();
        assert_eq!(review.rev, Some(rev));
        assert_eq!(
            review.format,
            match format {
                MockFormat::ShareJs => DocFormat::ShareJs,
                MockFormat::HistoryOt => DocFormat::HistoryOt,
            }
        );
        live.stop().await;
    }
}

#[tokio::test]
async fn viewers_may_comment_and_link_viewers_may_not() {
    for format in [MockFormat::ShareJs, MockFormat::HistoryOt] {
        let rig = review_rig(format, true).await;
        let main = rig.id(MAIN);
        let port = fresh_port();
        let (live, _tab) = go_live(&rig, "dave", &port).await;
        let made = live
            .comment(&main, 6, 11, None, "Viewer note")
            .await
            .unwrap();
        assert!(live.settle(WAIT).await);
        eventually("the viewer's anchor lands", || {
            server_comment(&rig, &made.thread).is_some()
        })
        .await;
        assert_eq!(
            live.decide(&change_ids(&live, &main), Decision::Reject)
                .await,
            Err(ReviewWriteError::Gone)
        );
        assert_eq!(
            live.set_track_changes(TrackScope::Me, true).await,
            Err(ReviewWriteError::NotAllowed)
        );
        live.stop().await;
        let fetched = rig.mock.requests(&path_of(&rig)).len();
        let port = fresh_port();
        let (tess, _tab) = go_live(&rig, "tess", &port).await;
        assert_eq!(
            tess.comment(&main, 0, 5, None, "No").await,
            Err(ReviewWriteError::Restricted)
        );
        assert!(!tess.review_support().threads);
        assert!(!tess.threads().loaded);
        assert_eq!(rig.mock.requests(&path_of(&rig)).len(), fetched);
        tess.stop().await;
    }
}

#[tokio::test]
async fn replies_edits_deletes_and_thread_actions_reach_the_server() {
    for format in [MockFormat::ShareJs, MockFormat::HistoryOt] {
        let rig = review_rig(format, true).await;
        let main = rig.id(MAIN);
        let port = fresh_port();
        let (live, _tab) = go_live(&rig, "alice", &port).await;
        let thread = live
            .comment(&main, 0, 5, None, "Start")
            .await
            .unwrap()
            .thread;
        assert!(live.settle(WAIT).await);
        let reply = live.reply(&thread, "Reply").await.unwrap().unwrap();
        assert_eq!(messages(&rig, &thread), ["Start", "Reply"]);
        live.edit_message(&thread, &reply.id, "Reply, edited")
            .await
            .unwrap();
        assert_eq!(messages(&rig, &thread), ["Start", "Reply, edited"]);
        assert_eq!(cached(&live, &thread), ["Start", "Reply, edited"]);
        live.delete_message(&thread, &reply.id, true).await.unwrap();
        assert_eq!(messages(&rig, &thread), ["Start"]);
        let bob = rig.mock.peer("bob");
        let theirs = bob.post_message(&thread, "From bob").body["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            live.edit_message(&thread, &theirs, "Not mine").await,
            Err(ReviewWriteError::NotAllowed)
        );
        live.delete_message(&thread, &theirs, false).await.unwrap();
        assert_eq!(messages(&rig, &thread), ["Start"]);
        live.set_resolved(&main, &thread, true).await.unwrap();
        match format {
            MockFormat::ShareJs => {
                assert_eq!(rig.mock.threads()[&thread]["resolved"], json!(true));
                assert!(live.threads().threads[&thread].resolved.is_some());
            }
            MockFormat::HistoryOt => {
                assert!(live.settle(WAIT).await);
                assert_eq!(
                    server_comment(&rig, &thread).unwrap()["resolved"],
                    json!(true)
                );
                let review = live.review(&main).unwrap();
                assert_eq!(review.comments[0].resolved, Some(true));
            }
        }
        assert_eq!(live.review_counts()[0].1.resolved, 1);
        live.set_resolved(&main, &thread, false).await.unwrap();
        assert!(live.settle(WAIT).await);
        assert_eq!(live.review_counts()[0].1.open, 1);
        live.delete_thread(&main, &thread).await.unwrap();
        assert!(live.settle(WAIT).await);
        eventually("the anchor is gone", || {
            server_comment(&rig, &thread).is_none()
        })
        .await;
        if format == MockFormat::ShareJs {
            assert!(rig.mock.threads().get(&thread).is_none());
            assert!(!live.threads().threads.contains_key(&thread));
        }
        assert_eq!(quote_of(&live, &main, &thread), None);
        live.stop().await;
    }
}

#[tokio::test]
async fn a_reviewer_resolves_a_history_ot_thread_through_rest() {
    let rig = review_rig(MockFormat::HistoryOt, true).await;
    let main = rig.id(MAIN);
    let port = fresh_port();
    let (live, _tab) = go_live(&rig, "carol", &port).await;
    let thread = live
        .comment(&main, 0, 5, None, "Mine")
        .await
        .unwrap()
        .thread;
    assert!(live.settle(WAIT).await);
    let before = rig.mock.received("applyOtUpdate").len();
    live.set_resolved(&main, &thread, true).await.unwrap();
    eventually("the server resolves it", || {
        server_comment(&rig, &thread).is_some_and(|comment| comment["resolved"] == true)
    })
    .await;
    assert_eq!(rig.mock.received("applyOtUpdate").len(), before);
    eventually("the broadcast reaches carol", || {
        live.review(&main)
            .is_some_and(|review| review.comments[0].resolved == Some(true))
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn decisions_follow_the_format_and_the_role() {
    for format in [MockFormat::ShareJs, MockFormat::HistoryOt] {
        let rig = review_rig(format, true).await;
        let main = rig.id(MAIN);
        let mut bob = rig.mock.peer("bob");
        bob.join(&main.0);
        let port = fresh_port();
        let (live, mut tab) = go_live(&rig, "alice", &port).await;
        bob.track_insert(&main.0, 6, "brave ");
        bob.track_insert(&main.0, 0, "Oh ");
        eventually("both suggestions arrive", || {
            change_ids(&live, &main).len() == 2
        })
        .await;
        let ids = change_ids(&live, &main);
        assert_eq!(
            live.decide(&["missing".into()], Decision::Accept).await,
            Err(ReviewWriteError::Gone)
        );
        let decided = live.decide(&ids[..1], Decision::Reject).await.unwrap();
        assert!(decided.missing.is_empty());
        assert!(live.settle(WAIT).await);
        assert_eq!(
            rig.mock.doc_text(&main.0),
            "Hello brave world\n",
            "{format:?}"
        );
        assert_eq!(tab.text(&live), "Hello brave world\n");
        let left = change_ids(&live, &main);
        assert_eq!(left.len(), 1);
        live.decide(&left, Decision::Accept).await.unwrap();
        assert!(live.settle(WAIT).await);
        eventually("the accept lands", || change_ids(&live, &main).is_empty()).await;
        assert_eq!(rig.mock.doc_text(&main.0), "Hello brave world\n");
        match format {
            MockFormat::ShareJs => assert_eq!(rig.mock.ranges(&main.0), json!({})),
            MockFormat::HistoryOt => {
                assert_eq!(rig.mock.raw_doc(&main.0)["trackedChanges"], json!([]))
            }
        }
        live.stop().await;
    }
}

#[tokio::test]
async fn an_accept_waits_for_ids_the_server_made_at_random() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    let port = fresh_port();
    let (live, _tab) = go_live(&rig, "alice", &port).await;
    bob.track_insert(&main.0, 6, "brave ");
    bob.type_at(&main.0, 8, "X");
    eventually("the split arrives", || change_ids(&live, &main).len() == 2).await;
    let ids = change_ids(&live, &main);
    assert!(ids.iter().any(|id| id.starts_with("local-")), "{ids:?}");
    live.decide(&ids, Decision::Accept).await.unwrap();
    assert_eq!(rig.mock.ranges(&main.0), json!({}));
    assert!(change_ids(&live, &main).is_empty());
    live.stop().await;
}

#[tokio::test]
async fn an_accept_asks_for_the_ids_again_after_the_checks_gave_up() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    let port = fresh_port();
    let (live, _tab) = go_live(&rig, "alice", &port).await;
    bob.track_insert(&main.0, 6, "brave ");
    bob.type_at(&main.0, 8, "X");
    eventually("the split arrives", || change_ids(&live, &main).len() == 2).await;
    let ids = change_ids(&live, &main);
    rig.mock.lose_ops(&main.0);
    assert_eq!(
        live.decide(&ids, Decision::Accept).await,
        Err(ReviewWriteError::Gone)
    );
    rig.mock.restore_ops(&main.0);
    live.decide(&ids, Decision::Accept).await.unwrap();
    assert_eq!(rig.mock.ranges(&main.0), json!({}));
    assert!(change_ids(&live, &main).is_empty());
    live.stop().await;
}

#[tokio::test]
async fn a_reviewer_only_withdraws_their_own_suggestions() {
    for format in [MockFormat::ShareJs, MockFormat::HistoryOt] {
        let rig = review_rig(format, true).await;
        let main = rig.id(MAIN);
        let mut bob = rig.mock.peer("bob");
        bob.join(&main.0);
        let port = fresh_port();
        let (live, mut tab) = go_live(&rig, "carol", &port).await;
        bob.track_insert(&main.0, 0, "Bob ");
        eventually("bob's suggestion arrives", || {
            change_ids(&live, &main).len() == 1
        })
        .await;
        let theirs = change_ids(&live, &main);
        tab.type_end(&live, " mine");
        assert!(live.settle(WAIT).await);
        eventually("carol's suggestion is acked", || {
            change_ids(&live, &main).len() == 2
        })
        .await;
        let mine: Vec<String> = change_ids(&live, &main)
            .into_iter()
            .filter(|id| !theirs.contains(id))
            .collect();
        assert_eq!(
            live.decide(&theirs, Decision::Reject).await,
            Err(ReviewWriteError::NotAllowed)
        );
        let own = live.decide(&mine, Decision::Reject).await;
        match format {
            MockFormat::ShareJs => {
                own.unwrap();
                assert!(live.settle(WAIT).await);
                assert_eq!(rig.mock.doc_text(&main.0), "Bob Hello world\n");
            }
            MockFormat::HistoryOt => assert_eq!(own, Err(ReviewWriteError::NotAllowed)),
        }
        assert_eq!(
            live.decide(&mine, Decision::Accept).await.err(),
            Some(match format {
                MockFormat::ShareJs => ReviewWriteError::Gone,
                MockFormat::HistoryOt => ReviewWriteError::NotAllowed,
            })
        );
        live.stop().await;
    }
}

#[tokio::test]
async fn track_changes_switches_follow_overleaf_role_rules() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let port = fresh_port();
    let (live, _tab) = go_live(&rig, "alice", &port).await;
    let mode = live.edit_mode();
    assert!(!mode.tracking && mode.switchable && mode.manage);
    live.set_track_changes(TrackScope::Me, true).await.unwrap();
    assert!(live.edit_mode().tracking);
    live.set_track_changes(TrackScope::Guests, true)
        .await
        .unwrap();
    assert!(live.edit_mode().guests);
    live.set_track_changes(TrackScope::Everyone, true)
        .await
        .unwrap();
    assert!(live.edit_mode().everyone);
    live.set_track_changes(TrackScope::Everyone, false)
        .await
        .unwrap();
    assert!(!live.edit_mode().everyone && !live.edit_mode().tracking);
    let state = rig.mock.peer("bob").rest("GET", "/threads", None);
    assert_eq!(state.status, 200);
    assert!(!rig.user_id("alice").is_empty());
    live.stop().await;
    let port = fresh_port();
    let (bob, _tab) = go_live(&rig, "bob", &port).await;
    bob.set_track_changes(TrackScope::Me, true).await.unwrap();
    assert_eq!(
        bob.set_track_changes(TrackScope::Everyone, true).await,
        Err(ReviewWriteError::NotAllowed)
    );
    assert!(!bob.edit_mode().manage);
    bob.stop().await;
    let port = fresh_port();
    let (carol, _tab) = go_live(&rig, "carol", &port).await;
    assert_eq!(carol.edit_mode().role, Role::Reviewer);
    assert_eq!(carol.edit_mode().locked, Some(ModeLock::Reviewer));
    assert_eq!(
        carol.set_track_changes(TrackScope::Me, false).await,
        Err(ReviewWriteError::NotAllowed)
    );
    carol.stop().await;
}

#[tokio::test]
async fn without_the_review_module_only_the_ops_work() {
    for format in [MockFormat::ShareJs, MockFormat::HistoryOt] {
        let rig = review_rig(format, false).await;
        let main = rig.id(MAIN);
        let mut bob = rig.mock.peer("bob");
        bob.join(&main.0);
        bob.comment(&main.0, 0, 5, T1);
        bob.track_insert(&main.0, 6, "brave ");
        let port = fresh_port();
        let (live, _tab) = go_live(&rig, "alice", &port).await;
        eventually("the ranges arrive", || {
            live.review(&main)
                .is_some_and(|review| review.changes.len() == 1 && review.comments.len() == 1)
        })
        .await;
        let review = live.review(&main).unwrap();
        assert!(review.can_accept);
        let resolved = live.set_resolved(&main, T1, true).await;
        let accepted = live
            .decide(&change_ids(&live, &main), Decision::Accept)
            .await;
        assert_eq!(
            live.set_track_changes(TrackScope::Me, true).await,
            Err(ReviewWriteError::Absent)
        );
        accepted.unwrap();
        assert!(live.settle(WAIT).await);
        assert_eq!(rig.mock.doc_text(&main.0), "Hello brave world\n");
        match format {
            MockFormat::ShareJs => {
                assert_eq!(resolved, Err(ReviewWriteError::Absent));
                assert!(rig.mock.ranges(&main.0)["changes"]
                    .as_array()
                    .is_none_or(Vec::is_empty));
                assert!(rig.mock.ranges(&main.0)["comments"]
                    .as_array()
                    .is_some_and(|comments| comments.len() == 1));
            }
            MockFormat::HistoryOt => {
                resolved.unwrap();
                assert!(live.settle(WAIT).await);
                assert_eq!(server_comment(&rig, T1).unwrap()["resolved"], json!(true));
                assert_eq!(rig.mock.raw_doc(&main.0)["trackedChanges"], json!([]));
            }
        }
        live.stop().await;
    }
}

fn edit_from(
    live: &OverleafSession,
    tab: &mut Tab,
    origin: Origin,
    edit: impl FnOnce(&mut EditorDoc) -> Option<(u64, oleafly_ot::TextOperation)>,
) {
    tab.pump(live);
    if let Some((rev, op)) = edit(&mut tab.editor) {
        live.editor_change_from(&tab.doc, rev, op, Some(origin))
            .unwrap();
    }
    tab.pump(live);
}

#[tokio::test]
async fn undo_and_paste_origins_keep_suggestions_and_comments_honest() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.comment(&main.0, 6, 5, T2);
    let port = fresh_port();
    let (live, mut tab) = go_live(&rig, "alice", &port).await;
    eventually("the comment arrives", || {
        quote_of(&live, &main, T2).is_some()
    })
    .await;
    edit_from(&live, &mut tab, Origin::Cut, |editor| {
        editor.jump(11);
        editor.backspace(6).unwrap()
    });
    assert!(live.settle(WAIT).await);
    edit_from(&live, &mut tab, Origin::Paste, |editor| {
        editor.jump(0);
        editor.type_text(" world").unwrap()
    });
    assert!(live.settle(WAIT).await);
    let pasted = rig.updates_for(&main).pop().unwrap();
    assert_eq!(
        pasted["op"],
        json!([{ "p": 0, "i": " world" }, { "p": 1, "c": "world", "t": T2 }])
    );
    assert_eq!(quote_of(&live, &main, T2).as_deref(), Some("world"));
    edit_from(&live, &mut tab, Origin::Undo, |editor| {
        editor.jump(12);
        editor.type_text("!").unwrap()
    });
    assert!(live.settle(WAIT).await);
    let undone = rig.updates_for(&main).pop().unwrap();
    assert_eq!(undone["op"], json!([{ "p": 12, "i": "!", "u": true }]));
    assert_eq!(tab.text(&live), " worldHello\n!");
    live.stop().await;
}

#[tokio::test]
async fn threads_are_fetched_again_after_a_reconnect() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let port = fresh_port();
    let (live, _tab) = go_live(&rig, "alice", &port).await;
    eventually("the threads load", || live.threads().loaded).await;
    let path = format!("/project/{}/threads", rig.mock.project_id());
    let before = rig.mock.requests(&path).len();
    rig.mock.peer("bob").post_message(T1, "While you were away");
    let public_id = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&public_id);
    eventually("the threads are fetched again", || {
        rig.mock.requests(&path).len() > before && cached(&live, T1).len() == 1
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn stop_returns_within_its_bound_while_a_thread_fetch_stalls() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let path = path_of(&rig);
    for _ in 0..4 {
        rig.mock
            .plan_fault(Some("GET"), &path, Fault::Delay(Duration::from_secs(600)));
    }
    let port = fresh_port();
    rig.seed("alice", 0).await;
    let live = rig.live("alice", &port).await;
    eventually("the probe is waiting on the server", || {
        !rig.mock.requests(&path).is_empty()
    })
    .await;
    let started = Instant::now();
    assert!(live.stop_within(Duration::from_secs(5)).await);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    let rig = review_rig(MockFormat::ShareJs, true).await;
    for _ in 0..4 {
        rig.mock.plan_fault(
            Some("GET"),
            &path_of(&rig),
            Fault::Delay(Duration::from_secs(600)),
        );
    }
    rig.seed("alice", 0).await;
    let live = rig.live("alice", &port).await;
    tokio::time::pause();
    let started = tokio::time::Instant::now();
    live.stop_within(Duration::from_millis(1_500)).await;
    assert!(started.elapsed() <= Duration::from_millis(1_500));
    tokio::time::resume();
}

fn path_of(rig: &Rig) -> String {
    format!("/project/{}/threads", rig.mock.project_id())
}

fn busy(rig: &Rig, requests: usize) {
    for _ in 0..requests {
        rig.mock.plan_fault(
            Some("GET"),
            &path_of(rig),
            Fault::Reply(503, "Service Unavailable".into()),
        );
    }
}

fn retrying() -> SessionTuning {
    SessionTuning {
        review_retry: Duration::from_millis(20),
        ..tuning()
    }
}

fn last_trouble(port: &Port) -> Option<Option<String>> {
    port.seen()
        .review
        .last()
        .map(|change| change.trouble.clone())
}

#[tokio::test]
async fn an_unsure_first_probe_falls_back_to_the_page_and_asks_again() {
    for review in [true, false] {
        let rig = review_rig(MockFormat::ShareJs, review).await;
        rig.mock.peer("bob").post_message(T1, "Already there");
        busy(&rig, 3);
        let port = fresh_port();
        let (live, _tab) = go_live_tuned(&rig, "alice", &port, retrying()).await;
        eventually("the probe is asked again or the threads are read", || {
            rig.mock.requests(&path_of(&rig)).len() > 3
        })
        .await;
        eventually("the trouble clears", || last_trouble(&port) == Some(None)).await;
        assert!(
            port.seen()
                .review
                .iter()
                .any(|change| change.trouble.is_some()),
            "{review}"
        );
        assert_eq!(live.review_support().threads, review);
        if review {
            eventually("the threads load", || cached(&live, T1).len() == 1).await;
        } else {
            assert!(!live.threads().loaded);
        }
        live.stop().await;
    }
}

#[tokio::test]
async fn threads_are_fetched_again_later_once_the_tries_run_out() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    rig.mock.peer("bob").post_message(T1, "Before");
    let port = fresh_port();
    let (live, _tab) = go_live_tuned(&rig, "alice", &port, retrying()).await;
    eventually("the threads load", || cached(&live, T1).len() == 1).await;
    rig.mock.hold_room_events();
    rig.mock
        .peer("bob")
        .post_message(T1, "While the server was busy");
    busy(&rig, 12);
    let public_id = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&public_id);
    eventually("the fetch reports trouble", || {
        port.seen()
            .review
            .iter()
            .any(|change| change.trouble.is_some())
    })
    .await;
    eventually("a later fetch brings the missed message", || {
        cached(&live, T1).len() == 2
    })
    .await;
    eventually("the trouble clears", || last_trouble(&port) == Some(None)).await;
    rig.mock.release_room_events();
    live.stop().await;
}

fn message(id: &str, content: &str) -> ThreadMessage {
    ThreadMessage {
        id: id.into(),
        user_id: None,
        content: content.into(),
        timestamp: Some(1),
        edited_at: None,
        user: None,
    }
}

fn thread(messages: &[(&str, &str)]) -> Thread {
    Thread {
        id: T1.into(),
        messages: messages
            .iter()
            .map(|(id, content)| message(id, content))
            .collect(),
        resolved: None,
    }
}

#[test]
fn a_failed_thread_fetch_does_not_replay_its_events_over_a_later_one() {
    let mut state = watcher(&[]);
    state.set_review_support(true);
    state.refetch_threads();
    assert!(state.take_thread_fetch());
    state.threads_fetched(vec![thread(&[("m1", "Before")])]);
    state.refetch_threads();
    assert!(state.take_thread_fetch());
    state.review_event(ReviewEvent::NewComment {
        thread: T1.into(),
        message: Box::new(message("m2", "Deleted soon")),
    });
    state.thread_fetch_failed(None);
    state.review_event(ReviewEvent::MessageDeleted {
        thread: T1.into(),
        message: "m2".into(),
    });
    state.refetch_threads();
    assert!(state.take_thread_fetch());
    state.threads_fetched(vec![thread(&[("m1", "Before")])]);
    assert_eq!(message_ids(&state), ["m1"]);
}

fn message_ids(state: &State) -> Vec<String> {
    state.threads_view().threads[T1]
        .messages
        .iter()
        .map(|message| message.id.clone())
        .collect()
}

#[test]
fn events_seen_after_an_absent_thread_fetch_are_not_replayed_later() {
    let mut state = watcher(&[]);
    state.set_review_support(true);
    state.refetch_threads();
    assert!(state.take_thread_fetch());
    state.set_review_support(false);
    state.review_event(ReviewEvent::NewComment {
        thread: T1.into(),
        message: Box::new(message("m2", "Deleted while away")),
    });
    state.set_review_support(true);
    state.refetch_threads();
    assert!(state.take_thread_fetch());
    state.threads_fetched(vec![thread(&[("m1", "Before")])]);
    assert_eq!(message_ids(&state), ["m1"]);
}

#[test]
fn a_fetch_that_changes_no_thread_still_clears_the_trouble() {
    let mut state = watcher(&[]);
    state.set_review_support(true);
    state.review_trouble("HTTP 503".into());
    state.report_review();
    state.deliver();
    assert_eq!(last_trouble(&state.port), Some(Some("HTTP 503".into())));
    state.refetch_threads();
    assert!(state.take_thread_fetch());
    state.threads_fetched(Vec::new());
    state.report_review();
    state.deliver();
    assert_eq!(last_trouble(&state.port), Some(None));
}

#[tokio::test]
async fn a_burst_of_remote_ops_gives_a_handful_of_review_notices() {
    let rig = review_rig(MockFormat::ShareJs, true).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.comment(&main.0, 6, 5, T1);
    let port = fresh_port();
    let tuned = SessionTuning {
        tick: Duration::from_millis(100),
        ..tuning()
    };
    let (live, _tab) = go_live_tuned(&rig, "alice", &port, tuned).await;
    eventually("the comment arrives", || {
        quote_of(&live, &main, T1).is_some()
    })
    .await;
    eventually("the notices settle", || {
        port.seen()
            .review
            .iter()
            .all(|change| change.trouble.is_none())
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let before = port.seen().review.len();
    for _ in 0..1_000 {
        bob.type_at(&main.0, 0, "x");
    }
    eventually("the shifts arrive", || {
        live.text(&main)
            .is_some_and(|text| text.len() == TEXT.len() + 1_000)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let shifted = port.seen().review[before..]
        .iter()
        .filter(|change| change.docs.contains(&main))
        .count();
    assert_eq!(shifted, 0, "pure shifts never notify");
    let before = port.seen().review.len();
    for _ in 0..1_000 {
        bob.type_at(&main.0, 1_008, "y");
    }
    eventually("the growth arrives", || {
        quote_of(&live, &main, T1).is_some_and(|quote| quote.len() == 1_005)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let grown = port.seen().review[before..]
        .iter()
        .filter(|change| change.docs.contains(&main))
        .count();
    assert!((1..=12).contains(&grown), "{grown} notices for 1,000 ops");
    live.stop().await;
}

#[tokio::test]
async fn a_tracked_delete_counts_as_a_change_with_its_text() {
    let rig = review_rig(MockFormat::HistoryOt, true).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    let port = fresh_port();
    let (live, _tab) = go_live(&rig, "alice", &port).await;
    bob.track_delete(&main.0, 0, 6);
    eventually("the delete arrives", || change_ids(&live, &main).len() == 1).await;
    let change = live.review(&main).unwrap().changes.remove(0);
    assert_eq!(
        (change.kind, change.from, change.to, change.text.as_str()),
        (ChangeKind::Delete, 0, 0, "Hello ")
    );
    assert_eq!(change.user, Some(rig.user_id("bob")));
    assert_eq!(live.review_counts()[0].1.changes, 1);
    live.stop().await;
}
