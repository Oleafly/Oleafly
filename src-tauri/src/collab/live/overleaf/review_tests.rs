use oleafly_collab::comments::{CommentMember, CommentRange};
use oleafly_collab::suggestions::{EditMode, SuggestionKind};
use oleafly_online::live::doc::{Origin, ReviewOp};
use oleafly_online::live::session::ReviewChange;
use oleafly_online::realtime::DocId;
use oleafly_online::test_support::mock_overleaf::{
    DocFormat as MockFormat, MockProject, MockUser, Privilege,
};
use oleafly_ot::TextOperation;
use serde_json::Value;

use super::review::{trouble_lines, OnlineMember, OnlineThread};
use super::rig::{eventually, run, OverleafRig};
use crate::collab::comments::{CommentCount, CommentsStatus};
use crate::collab::suggesting::{Decision, EditModeLock, EditModeScope, SuggestionCount};

const MAIN: &str = "main.tex";
const NOTES: &str = "notes.tex";
const TEXT: &str = "The quick brown fox jumps over the lazy dog.\n";
const NOTE: &str = "Notes on foxes.\n";
const T1: &str = "6b04e5f6c0ffee0010000001";
const T2: &str = "6b04e5f6c0ffee0011000001";
const FORMATS: [MockFormat; 2] = [MockFormat::ShareJs, MockFormat::HistoryOt];

fn project(format: MockFormat) -> MockProject {
    MockProject::new("review")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("tess"))
        .format(format)
        .doc(MAIN, TEXT)
        .doc(NOTES, NOTE)
}

fn id(name: &str) -> String {
    MockUser::named(name).id
}

fn members() -> Vec<OnlineMember> {
    ["alice", "bob", "carol", "dave"]
        .into_iter()
        .map(|name| {
            let user = MockUser::named(name);
            CommentMember {
                account_id: user.id,
                display_name: format!("{} {}", user.first_name, user.last_name),
                login: None,
            }
        })
        .collect()
}

async fn rig_as(format: MockFormat, name: &str, review: bool) -> OverleafRig {
    let rig = OverleafRig::start_review(
        project(format),
        &[(MAIN, TEXT), (NOTES, NOTE)],
        name,
        review,
    )
    .await;
    rig.open(MAIN);
    rig.open(NOTES);
    let docs = [DocId(rig.doc(MAIN)), DocId(rig.doc(NOTES))];
    let loads = review && name != "tess";
    eventually(
        "the documents are joined and the review module is probed",
        || {
            let session = &rig.live.session;
            session.review_support().probed
                && docs.iter().all(|doc| session.review(doc).is_some())
                && (!loads || session.threads().loaded)
        },
    )
    .await;
    rig
}

fn listed(rig: &OverleafRig, path: &str) -> Vec<OnlineThread> {
    rig.live.thread_list(path).unwrap().threads
}

fn server_anchor(rig: &OverleafRig, doc: &str, thread: &str) -> Option<Value> {
    let ranges = rig.mock.ranges(doc);
    let raw = rig.mock.raw_doc(doc);
    ranges["comments"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(raw["comments"].as_array().into_iter().flatten())
        .find(|comment| comment["id"] == thread)
        .cloned()
}

fn server_messages(rig: &OverleafRig, thread: &str) -> Vec<String> {
    rig.mock.threads()[thread]["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|message| message["content"].as_str().unwrap_or_default().to_owned())
        .collect()
}

fn server_resolved(rig: &OverleafRig, format: MockFormat, doc: &str, thread: &str) -> bool {
    match format {
        MockFormat::ShareJs => rig.mock.threads()[thread]["resolved"] == true,
        MockFormat::HistoryOt => {
            server_anchor(rig, doc, thread).is_some_and(|comment| comment["resolved"] == true)
        }
    }
}

fn told_comments(rig: &OverleafRig, doc: &str, local: bool) -> usize {
    rig.host
        .comments
        .lock()
        .unwrap()
        .iter()
        .filter(|payload| payload.local == local && payload.file_ids.iter().any(|id| id == doc))
        .count()
}

fn told_suggestions(rig: &OverleafRig, path: &str, local: bool) -> usize {
    rig.host
        .suggestions
        .lock()
        .unwrap()
        .iter()
        .filter(|payload| payload.local == local && payload.paths.iter().any(|known| known == path))
        .count()
}

fn change_ids(rig: &OverleafRig, path: &str) -> Vec<String> {
    rig.live
        .suggestion_list(path)
        .unwrap()
        .suggestions
        .into_iter()
        .map(|suggestion| suggestion.id)
        .collect()
}

fn posted_id(reply: &oleafly_online::test_support::mock_overleaf::PeerReply) -> String {
    reply.body["id"].as_str().unwrap().to_owned()
}

#[test]
fn threads_from_overleaf_are_listed_answered_resolved_and_deleted_in_both_formats() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "alice", true).await;
            let main = rig.doc(MAIN);
            let mut bob = rig.mock.peer("bob");
            bob.join(&main);
            let question = format!("Is this right, @[{}]?", id("alice"));
            assert_eq!(bob.post_message(T1, &question).status, 201);
            bob.comment(&main, 4, 11, T1);
            eventually("bob's thread is listed", || listed(&rig, MAIN).len() == 1).await;
            let thread = listed(&rig, MAIN).remove(0);
            assert_eq!(thread.id, T1);
            assert_eq!(thread.file_id, main);
            assert_eq!(thread.anchor.quote, "quick brown");
            assert_eq!(thread.anchor.range, Some(CommentRange { from: 4, to: 15 }));
            assert_eq!(thread.created_by, id("bob"));
            assert!(thread.resolved.is_none() && thread.verified);
            let first = &thread.messages[0];
            assert_eq!(first.body, "Is this right, @Alice Tester?");
            assert_eq!(first.mentions, vec![id("alice")]);
            assert_eq!(first.author, id("bob"));
            assert!(first.verified && !first.pending && first.reactions.is_empty());
            eventually("the mention reaches the window", || {
                rig.host.comments.lock().unwrap().iter().any(|payload| {
                    !payload.local
                        && payload.mentioned.iter().any(|mention| {
                            mention.thread_id == T1
                                && mention.author == id("bob")
                                && mention.path.as_deref() == Some(MAIN)
                        })
                })
            })
            .await;

            let reply = rig
                .live
                .reply(&main, T1, "Yes, @Bob Tester.", &members())
                .await
                .unwrap();
            assert_eq!(reply.author, id("alice"));
            assert_eq!(reply.body, "Yes, @Bob Tester.");
            assert_eq!(reply.mentions, vec![id("bob")]);
            assert_eq!(
                server_messages(&rig, T1),
                vec![question.clone(), format!("Yes, @[{}].", id("bob"))]
            );
            let edited = rig
                .live
                .edit_message(&main, T1, &reply.id, "Yes indeed", &members())
                .await
                .unwrap();
            assert_eq!(edited.body, "Yes indeed");
            assert!(edited.edited_at.is_some());
            assert_eq!(server_messages(&rig, T1)[1], "Yes indeed");
            let theirs = rig
                .live
                .edit_message(&main, T1, &first.id, "Not mine", &members())
                .await
                .unwrap_err();
            assert_eq!(theirs.code, "comment_not_yours");

            let resolved = rig.live.set_resolved(&main, T1, true).await.unwrap();
            assert_eq!(
                resolved.resolved.as_ref().map(|by| by.by.as_str()),
                Some(id("alice").as_str())
            );
            assert!(listed(&rig, MAIN)[0].resolved.is_some());
            eventually("the server has the thread resolved", || {
                server_resolved(&rig, format, &main, T1)
            })
            .await;
            assert_eq!(
                rig.live.comment_counts(),
                vec![CommentCount {
                    path: MAIN.to_owned(),
                    open: 0,
                    resolved: 1,
                    waiting: 0,
                }]
            );
            let reopened = rig.live.set_resolved(&main, T1, false).await.unwrap();
            assert!(reopened.resolved.is_none());
            assert!(listed(&rig, MAIN)[0].resolved.is_none());
            eventually("the server has the thread open again", || {
                !server_resolved(&rig, format, &main, T1)
            })
            .await;

            rig.live
                .delete_message(&main, T1, &reply.id, true)
                .await
                .unwrap();
            assert_eq!(server_messages(&rig, T1), vec![question.clone()]);
            let extra = posted_id(&bob.post_message(T1, "One more thing"));
            rig.live
                .delete_message(&main, T1, &extra, false)
                .await
                .unwrap();
            assert_eq!(server_messages(&rig, T1), vec![question]);

            rig.live.delete_thread(&main, T1).await.unwrap();
            assert!(listed(&rig, MAIN).is_empty());
            eventually(
                "the anchor leaves the server, and on ShareJS the thread too",
                || {
                    let chat_gone =
                        format == MockFormat::HistoryOt || rig.mock.threads().get(T1).is_none();
                    chat_gone && server_anchor(&rig, &main, T1).is_none()
                },
            )
            .await;
            assert!(rig.live.comment_counts().is_empty());
            assert!(told_comments(&rig, &main, true) > 0);
            rig.finish().await;
        }
    });
}

#[test]
fn a_comment_added_here_shows_at_once_and_reaches_overleaf_in_both_formats() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "alice", true).await;
            let notes = rig.doc(NOTES);
            let created = rig
                .live
                .comment(NOTES, 9, 14, None, "Which ones, @Bob Tester?", &members())
                .await
                .unwrap();
            assert_eq!(created.file_id, notes);
            assert_eq!(created.anchor.quote, "foxes");
            assert_eq!(created.anchor.range, Some(CommentRange { from: 9, to: 14 }));
            assert_eq!(created.created_by, id("alice"));
            assert_eq!(created.messages[0].body, "Which ones, @Bob Tester?");
            assert_eq!(created.messages[0].mentions, vec![id("bob")]);
            assert!(created.messages[0].pending);
            assert_eq!(
                listed(&rig, NOTES)
                    .iter()
                    .map(|thread| thread.id.as_str())
                    .collect::<Vec<_>>(),
                vec![created.id.as_str()]
            );
            eventually("the anchor reaches Overleaf and the list", || {
                server_anchor(&rig, &notes, &created.id).is_some()
                    && listed(&rig, NOTES)
                        .first()
                        .is_some_and(|thread| !thread.messages[0].pending)
            })
            .await;
            assert_eq!(
                server_messages(&rig, &created.id),
                vec![format!("Which ones, @[{}]?", id("bob"))]
            );
            assert_eq!(listed(&rig, NOTES)[0].anchor.quote, "foxes");
            assert_eq!(
                rig.live.comment_counts(),
                vec![CommentCount {
                    path: NOTES.to_owned(),
                    open: 1,
                    resolved: 0,
                    waiting: 0,
                }]
            );
            assert!(told_comments(&rig, &notes, true) > 0);
            assert_eq!(told_comments(&rig, &notes, false), 0);

            let _tab = rig.open(MAIN);
            let refusals = [
                rig.live.comment(MAIN, 0, 3, Some(9_999), "Late", &[]).await,
                rig.live.comment(MAIN, 40, 99, None, "Out", &[]).await,
                rig.live.comment(MAIN, 0, 3, None, "  \n", &[]).await,
                rig.live
                    .comment(MAIN, 0, 3, None, &"x".repeat(10 * 1024 + 1), &[])
                    .await,
                rig.live.comment("missing.tex", 0, 3, None, "Hi", &[]).await,
            ];
            let codes: Vec<&str> = refusals
                .iter()
                .map(|refused| refused.as_ref().unwrap_err().code)
                .collect();
            assert_eq!(
                codes,
                vec![
                    "comment_selection_changed",
                    "comment_selection_changed",
                    "comment_empty",
                    "comment_too_long",
                    "not_found",
                ]
            );
            assert_eq!(rig.live.reactions_refused().code, "forbidden");
            rig.finish().await;
        }
    });
}

#[test]
fn without_the_review_module_comments_are_off_and_changes_still_show() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "alice", false).await;
            let main = rig.doc(MAIN);
            assert_eq!(
                rig.live.comments_status(),
                CommentsStatus {
                    server_allowed: false,
                    project_enabled: true,
                    can_comment: false,
                    reactions: false,
                    moderate: true,
                    typing: false,
                    suggestion_threads: false,
                }
            );
            let refused = rig
                .live
                .comment(MAIN, 4, 15, None, "Hi", &[])
                .await
                .unwrap_err();
            assert_eq!(refused.code, "comment_off_server");
            let mut bob = rig.mock.peer("bob");
            bob.join(&main);
            bob.comment(&main, 4, 11, T1);
            bob.track_insert(&main, 0, "Big ");
            eventually("bob's change is listed", || {
                change_ids(&rig, MAIN).len() == 1
            })
            .await;
            assert!(listed(&rig, MAIN).is_empty());
            assert!(rig.live.comment_counts().is_empty());
            let list = rig.live.suggestion_list(MAIN).unwrap();
            let change = &list.suggestions[0];
            assert_eq!(change.kind, SuggestionKind::Insert);
            assert_eq!(change.author, id("bob"));
            assert_eq!((change.from, change.to), (0, 4));
            assert_eq!(change.text, "Big ");
            assert_eq!(change.file_id, main);
            assert!(list.can_accept);
            assert_eq!(
                rig.live.suggestion_counts(),
                vec![SuggestionCount {
                    path: MAIN.to_owned(),
                    pending: 1,
                }]
            );
            assert!(told_suggestions(&rig, MAIN, false) > 0);
            let ids = change_ids(&rig, MAIN);
            rig.live.decide(&ids, Decision::Accept).await.unwrap();
            eventually("the accepted text stays and the change goes", || {
                rig.mock.doc_text(&main) == format!("Big {TEXT}")
                    && change_ids(&rig, MAIN).is_empty()
            })
            .await;
            bob.track_insert(&main, 0, "Old ");
            eventually("bob's second change is listed", || {
                change_ids(&rig, MAIN).len() == 1
            })
            .await;
            let ids = change_ids(&rig, MAIN);
            rig.live.decide(&ids, Decision::Reject).await.unwrap();
            eventually("the rejected text leaves the server", || {
                rig.mock.doc_text(&main) == format!("Big {TEXT}")
            })
            .await;
            eventually("the list is empty", || change_ids(&rig, MAIN).is_empty()).await;
            assert!(told_suggestions(&rig, MAIN, true) > 0);
            let gone = rig.live.decide(&ids, Decision::Reject).await.unwrap_err();
            assert_eq!(gone.code, "suggestion_gone");
            let mode = rig.live.edit_mode_state();
            assert_eq!(mode.locked, Some(EditModeLock::Server));
            assert!(!mode.switchable && !mode.manage);
            let switch = rig
                .live
                .set_edit_mode(EditMode::Suggesting, EditModeScope::Me)
                .await
                .unwrap_err();
            assert_eq!(switch.code, "review_off_server");
            rig.finish().await;
        }
    });
}

#[test]
fn a_reviewer_suggests_withdraws_where_overleaf_allows_and_cannot_decide() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "carol", true).await;
            let main = rig.doc(MAIN);
            let mode = rig.live.edit_mode_state();
            assert_eq!(mode.mode, EditMode::Suggesting);
            assert_eq!(mode.locked, Some(EditModeLock::Reviewer));
            assert!(!mode.switchable && !mode.manage);
            let mut tab = rig.open(MAIN);
            tab.typed(&rig.live, &format!("Yes {TEXT}"));
            assert!(told_suggestions(&rig, MAIN, true) > 0);
            eventually("her typing is a tracked change", || {
                rig.live
                    .suggestion_list(MAIN)
                    .unwrap()
                    .suggestions
                    .iter()
                    .any(|change| change.author == id("carol") && change.text == "Yes ")
            })
            .await;
            let list = rig.live.suggestion_list(MAIN).unwrap();
            assert!(!list.can_accept);
            let mine = change_ids(&rig, MAIN);
            for decision in [Decision::Accept, Decision::Reject] {
                let refused = rig.live.decide(&mine, decision).await.unwrap_err();
                assert_eq!(refused.code, "suggestion_role");
            }
            let whole = rig
                .live
                .decide_file(MAIN, Decision::Accept)
                .await
                .unwrap_err();
            assert_eq!(whole.code, "suggestion_role");
            let withdrawn = rig.live.decide(&mine, Decision::Withdraw).await;
            match format {
                MockFormat::ShareJs => {
                    withdrawn.unwrap();
                    eventually("her suggestion is gone from Overleaf", || {
                        rig.mock.doc_text(&main) == TEXT && change_ids(&rig, MAIN).is_empty()
                    })
                    .await;
                }
                MockFormat::HistoryOt => {
                    assert_eq!(withdrawn.unwrap_err().code, "review_off_server");
                }
            }

            let mut bob = rig.mock.peer("bob");
            bob.join(&main);
            bob.track_insert(&main, TEXT.len() - 1, " Bob");
            eventually("bob's change is listed", || {
                rig.live
                    .suggestion_list(MAIN)
                    .unwrap()
                    .suggestions
                    .iter()
                    .any(|change| change.author == id("bob"))
            })
            .await;
            let his: Vec<String> = rig
                .live
                .suggestion_list(MAIN)
                .unwrap()
                .suggestions
                .into_iter()
                .filter(|change| change.author == id("bob"))
                .map(|change| change.id)
                .collect();
            let refused = rig.live.decide(&his, Decision::Withdraw).await.unwrap_err();
            assert_eq!(refused.code, "suggestion_not_yours");

            assert_eq!(bob.post_message(T1, "Bob's").status, 201);
            bob.comment(&main, 4, 11, T1);
            let ours = rig
                .live
                .comment(MAIN, 20, 25, None, "Mine", &members())
                .await
                .unwrap();
            eventually(
                "her anchor reaches Overleaf and both threads are listed",
                || server_anchor(&rig, &main, &ours.id).is_some() && listed(&rig, MAIN).len() == 2,
            )
            .await;
            let resolved = rig.live.set_resolved(&main, &ours.id, true).await.unwrap();
            assert!(resolved.resolved.is_some());
            eventually("her own thread is resolved on Overleaf", || {
                server_resolved(&rig, format, &main, &ours.id)
            })
            .await;
            let theirs = rig.live.set_resolved(&main, T1, true).await.unwrap_err();
            assert_eq!(theirs.code, "comment_not_yours");
            let delete = rig.live.delete_thread(&main, T1).await.unwrap_err();
            assert_eq!(delete.code, "comment_not_yours");
            let status = rig.live.comments_status();
            assert!(status.can_comment && !status.moderate);
            rig.finish().await;
        }
    });
}

#[test]
fn a_viewer_comments_but_cannot_resolve_remove_or_decide() {
    run(async {
        let rig = rig_as(MockFormat::ShareJs, "dave", true).await;
        let main = rig.doc(MAIN);
        let status = rig.live.comments_status();
        assert!(status.server_allowed && status.can_comment && !status.moderate);
        let mut bob = rig.mock.peer("bob");
        bob.join(&main);
        let first = posted_id(&bob.post_message(T1, "Bob's"));
        bob.comment(&main, 4, 11, T1);
        bob.track_insert(&main, 0, "Big ");
        let ours = rig
            .live
            .comment(MAIN, 20, 25, None, "Dave here", &members())
            .await
            .unwrap();
        eventually("dave's anchor reaches Overleaf", || {
            server_anchor(&rig, &main, &ours.id).is_some()
        })
        .await;
        eventually("both threads are listed", || listed(&rig, MAIN).len() == 2).await;
        let codes = [
            rig.live
                .set_resolved(&main, T1, true)
                .await
                .unwrap_err()
                .code,
            rig.live
                .delete_message(&main, T1, &first, false)
                .await
                .unwrap_err()
                .code,
            rig.live
                .delete_message(&main, T1, &first, true)
                .await
                .unwrap_err()
                .code,
        ];
        assert_eq!(
            codes,
            [
                "comment_not_yours",
                "comment_not_yours",
                "comment_not_yours"
            ]
        );
        eventually("bob's change is listed", || {
            change_ids(&rig, MAIN).len() == 1
        })
        .await;
        let refused = rig
            .live
            .decide(&change_ids(&rig, MAIN), Decision::Accept)
            .await
            .unwrap_err();
        assert_eq!(refused.code, "suggestion_role");
        let mode = rig.live.edit_mode_state();
        assert_eq!(mode.mode, EditMode::Editing);
        assert!(!mode.switchable);
        let switch = rig
            .live
            .set_edit_mode(EditMode::Suggesting, EditModeScope::Me)
            .await
            .unwrap_err();
        assert_eq!(switch.code, "suggestion_role");
        rig.finish().await;
    });
}

#[test]
fn a_link_viewer_sees_no_comment_threads_and_cannot_comment() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "tess", true).await;
            let main = rig.doc(MAIN);
            let mut bob = rig.mock.peer("bob");
            bob.join(&main);
            assert_eq!(bob.post_message(T1, "Hidden").status, 201);
            bob.comment(&main, 4, 11, T1);
            bob.type_at(&main, 0, "A ");
            eventually("bob's typing arrives", || {
                rig.live.text_at(MAIN).as_deref() == Some(&*format!("A {TEXT}"))
            })
            .await;
            assert!(listed(&rig, MAIN).is_empty());
            assert!(rig.live.comment_counts().is_empty());
            let status = rig.live.comments_status();
            assert!(!status.project_enabled && !status.can_comment);
            let refused = rig
                .live
                .comment(MAIN, 4, 15, None, "Hi", &[])
                .await
                .unwrap_err();
            assert_eq!(refused.code, "comment_off_project");
            let reply = rig.live.reply(&main, T1, "Hi", &[]).await.unwrap_err();
            assert_eq!(reply.code, "comment_off_project");
            rig.finish().await;
        }
    });
}

#[test]
fn the_owner_switches_track_changes_for_herself_everyone_and_link_guests() {
    run(async {
        let rig = rig_as(MockFormat::ShareJs, "alice", true).await;
        let mode = rig.live.edit_mode_state();
        assert_eq!(mode.mode, EditMode::Editing);
        assert!(mode.switchable && mode.manage && mode.locked.is_none());
        assert_eq!((mode.everyone, mode.guests), (Some(false), Some(false)));
        rig.live
            .set_edit_mode(EditMode::Suggesting, EditModeScope::Me)
            .await
            .unwrap();
        eventually("her own edits are tracked", || {
            rig.live.edit_mode_state().mode == EditMode::Suggesting
        })
        .await;
        rig.live
            .set_edit_mode(EditMode::Suggesting, EditModeScope::Everyone)
            .await
            .unwrap();
        eventually("everyone is tracked", || {
            rig.live.edit_mode_state().everyone == Some(true)
        })
        .await;
        rig.live
            .set_edit_mode(EditMode::Suggesting, EditModeScope::Guests)
            .await
            .unwrap();
        eventually("link guests are tracked", || {
            rig.live.edit_mode_state().guests == Some(true)
        })
        .await;
        rig.live
            .set_edit_mode(EditMode::Editing, EditModeScope::Everyone)
            .await
            .unwrap();
        eventually("nobody is tracked", || {
            let mode = rig.live.edit_mode_state();
            mode.everyone == Some(false) && mode.mode == EditMode::Editing
        })
        .await;
        assert!(rig
            .host
            .roles
            .lock()
            .unwrap()
            .iter()
            .any(|role| role.tracking));
        rig.finish().await;

        let rig = rig_as(MockFormat::ShareJs, "bob", true).await;
        let refused = rig
            .live
            .set_edit_mode(EditMode::Suggesting, EditModeScope::Everyone)
            .await
            .unwrap_err();
        assert_eq!(refused.code, "suggestion_role");
        rig.live
            .set_edit_mode(EditMode::Suggesting, EditModeScope::Me)
            .await
            .unwrap();
        eventually("bob's own edits are tracked", || {
            rig.live.edit_mode_state().mode == EditMode::Suggesting
                && rig
                    .host
                    .roles
                    .lock()
                    .unwrap()
                    .last()
                    .is_some_and(|role| role.tracking)
        })
        .await;
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, &format!("{TEXT}More.\n"));
        assert!(told_suggestions(&rig, MAIN, true) > 0);
        rig.finish().await;
    });
}

#[test]
fn what_others_do_reaches_the_comment_change_and_status_events() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "bob", true).await;
            let main = rig.doc(MAIN);
            let notes = rig.doc(NOTES);
            eventually("the probed status reaches the status event", || {
                rig.host
                    .comment_status
                    .lock()
                    .unwrap()
                    .last()
                    .is_some_and(|payload| {
                        payload.status == rig.live.comments_status()
                            && payload.status.server_allowed
                            && payload.status.moderate
                    })
            })
            .await;
            eventually(
                "joining main.tex reaches the comment event as bob's own",
                || told_comments(&rig, &main, true) > 0,
            )
            .await;
            let quiet = told_comments(&rig, &main, true);
            let mut alice = rig.mock.peer("alice");
            alice.join(&main);
            alice.join(&notes);
            alice.track_insert(&notes, 0, "New ");
            eventually("alice's change reaches the change event", || {
                told_suggestions(&rig, NOTES, false) > 0
            })
            .await;
            assert_eq!(alice.post_message(T2, "From alice").status, 201);
            alice.comment(&main, 35, 8, T2);
            eventually("alice's thread reaches the comment event", || {
                told_comments(&rig, &main, false) > 0 && listed(&rig, MAIN).len() == 1
            })
            .await;
            let before = told_comments(&rig, &main, false);
            assert_eq!(alice.post_message(T2, "And more").status, 201);
            eventually("alice's reply reaches the comment event", || {
                told_comments(&rig, &main, false) > before
            })
            .await;
            assert_eq!(listed(&rig, MAIN)[0].messages.len(), 2);
            assert_eq!(told_comments(&rig, &main, true), quiet);
            rig.mock.set_privilege("bob", Some(Privilege::ReadOnly));
            eventually("the new role reaches the status event", || {
                rig.host
                    .comment_status
                    .lock()
                    .unwrap()
                    .last()
                    .is_some_and(|payload| !payload.status.moderate && payload.status.can_comment)
            })
            .await;
            rig.finish().await;
        }
    });
}

#[test]
fn cutting_and_pasting_commented_text_keeps_its_comment_in_both_formats() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "alice", true).await;
            let main = rig.doc(MAIN);
            let mut bob = rig.mock.peer("bob");
            bob.join(&main);
            assert_eq!(bob.post_message(T1, "Keep me").status, 201);
            bob.comment(&main, 4, 11, T1);
            let mut tab = rig.open(MAIN);
            eventually("bob's thread is listed", || listed(&rig, MAIN).len() == 1).await;
            let length = TEXT.len();
            tab.edit_with(&rig.live, Some(Origin::Cut), |_| {
                let mut op = TextOperation::new();
                op.retain(4).delete(12).retain(length - 16);
                op
            });
            tab.edit_with(&rig.live, Some(Origin::Paste), |_| {
                let mut op = TextOperation::new();
                op.retain(length - 13).insert("quick brown ").retain(1);
                op
            });
            eventually("the comment follows the pasted text", || {
                listed(&rig, MAIN).first().is_some_and(|thread| {
                    thread.anchor.quote == "quick brown"
                        && thread.anchor.range == Some(CommentRange { from: 32, to: 43 })
                })
            })
            .await;
            eventually("Overleaf has the comment on the pasted text", || {
                rig.mock.doc_text(&main) == "The fox jumps over the lazy dog.quick brown \n"
                    && server_anchor(&rig, &main, T1).is_some_and(|comment| {
                        comment["op"]["p"] == 32 || comment["ranges"][0]["pos"] == 32
                    })
            })
            .await;
            rig.finish().await;
        }
    });
}

#[test]
fn dropped_review_work_and_thread_trouble_are_logged_once() {
    run(async {
        let rig = rig_as(MockFormat::ShareJs, "alice", true).await;
        let doc = DocId(rig.doc(MAIN));
        let change = ReviewChange {
            dropped: vec![(
                doc.clone(),
                ReviewOp::Anchor {
                    thread: T1.to_owned(),
                    ranges: Vec::new(),
                    ride: false,
                },
            )],
            trouble: Some("the server could not be reached".to_owned()),
            ..ReviewChange::default()
        };
        let lines = trouble_lines(&rig.live.mirror, &change);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(lines[0].contains("comment anchor") && lines[0].contains(&doc.0));
        assert!(lines[1].contains("could not be reached"));
        let again = ReviewChange {
            dropped: Vec::new(),
            ..change.clone()
        };
        assert!(trouble_lines(&rig.live.mirror, &again).is_empty());
        let cleared = ReviewChange::default();
        assert!(trouble_lines(&rig.live.mirror, &cleared).is_empty());
        assert_eq!(trouble_lines(&rig.live.mirror, &again).len(), 1);
        rig.live.mirror.review_noticed(change);
        rig.finish().await;
    });
}

#[test]
fn every_change_in_a_file_is_accepted_or_rejected_at_once_in_both_formats() {
    run(async {
        for format in FORMATS {
            let rig = rig_as(format, "alice", true).await;
            let main = rig.doc(MAIN);
            let mut bob = rig.mock.peer("bob");
            bob.join(&main);
            bob.track_insert(&main, 0, "A ");
            bob.track_insert(&main, TEXT.len() + 1, " Z");
            eventually("both of bob's changes are listed", || {
                change_ids(&rig, MAIN).len() == 2
            })
            .await;
            assert!(rig.live.suggestion_list(MAIN).unwrap().can_accept);
            rig.live.decide_file(MAIN, Decision::Accept).await.unwrap();
            let accepted = format!("A {} Z\n", TEXT.trim_end());
            eventually("both changes are accepted", || {
                change_ids(&rig, MAIN).is_empty() && rig.mock.doc_text(&main) == accepted
            })
            .await;
            bob.track_insert(&main, 0, "B ");
            eventually("bob's next change is listed", || {
                change_ids(&rig, MAIN).len() == 1
            })
            .await;
            rig.live.decide_file(MAIN, Decision::Reject).await.unwrap();
            eventually("the change is rejected", || {
                change_ids(&rig, MAIN).is_empty() && rig.mock.doc_text(&main) == accepted
            })
            .await;
            rig.live.decide_file(MAIN, Decision::Reject).await.unwrap();
            assert!(told_suggestions(&rig, MAIN, true) > 0);
            assert_eq!(rig.live.suggestion_reply_refused().code, "forbidden");
            assert_eq!(rig.live.comments_switch_refused().code, "forbidden");
            rig.finish().await;
        }
    });
}
