use std::time::Duration;

use oleafly_ot::TextOperation;
use serde_json::json;

use super::super::{DocStopReason, LiveEnd, LiveError};
use super::{
    eventually, project, record_of, tracked, tuning, LiveState, MergeReview, MockRejection, Port,
    Rig, SessionTuning, Tab, FILES, INTRO, MAIN, NOTES, WAIT,
};
use crate::live::doc::DocFault;
use crate::live::journal::unsent_on;
use crate::live::DocId;
use crate::realtime::project::Role;
use crate::test_support::mock_overleaf::{MockUser, Privilege};

fn kept(port: &Port) -> Vec<String> {
    port.seen()
        .merged
        .iter()
        .filter_map(|(_, review)| match review {
            MergeReview::Kept { text } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

async fn unsent_edit(rig: &Rig, live: &super::OverleafSession, tab: &mut Tab, text: &str) {
    let before = rig.mock.received("applyOtUpdate").len();
    rig.mock.hold_updates();
    tab.type_end(live, text);
    eventually("the edit is sent and still unapplied", || {
        rig.mock.received("applyOtUpdate").len() > before
    })
    .await;
}

#[tokio::test]
async fn reviewer_ops_always_carry_tc() {
    let rig = Rig::start(project().member(MockUser::named("rita"), Privilege::Review)).await;
    rig.seed("rita", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("rita", &port).await;
    let main = rig.id(MAIN);
    assert_eq!(port.seen().roles.first(), Some(&(Role::Reviewer, true)));
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("rita").contains(&main.0)).await;
    tab.type_end(&live, " one");
    assert!(live.settle(WAIT).await);
    tab.type_at(&live, 0, "Oh ");
    assert!(live.settle(WAIT).await);
    let updates = rig.updates_for(&main);
    assert_eq!(updates.len(), 2);
    assert!(updates.iter().all(tracked), "{updates:?}");
    live.stop().await;
}

#[tokio::test]
async fn tracked_editor_ops_carry_tc() {
    let bob = MockUser::named("bob").id;
    let rig = Rig::start(project().track_changes(json!({ bob: true }))).await;
    rig.seed("bob", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("bob", &port).await;
    let main = rig.id(MAIN);
    assert_eq!(port.seen().roles.first(), Some(&(Role::Editor, true)));
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("bob").contains(&main.0)).await;
    tab.type_end(&live, " tracked");
    assert!(live.settle(WAIT).await);
    let update = rig.updates_for(&main).pop().unwrap();
    assert!(tracked(&update), "{update}");
    live.stop().await;
}

#[tokio::test]
async fn toggle_track_changes_switches_sending() {
    let rig = Rig::start(project().track_changes(json!(true))).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    assert_eq!(port.seen().roles.first(), Some(&(Role::Owner, true)));
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    tab.type_end(&live, " suggested");
    assert!(live.settle(WAIT).await);
    let update = rig.updates_for(&main).pop().unwrap();
    assert!(update["meta"]["tc"].is_string(), "{update}");
    rig.mock.set_track_changes(json!(false));
    eventually("tracking turns off", || {
        port.seen().roles.last() == Some(&(Role::Owner, false))
    })
    .await;
    tab.type_end(&live, " plain");
    assert!(live.settle(WAIT).await);
    let update = rig.updates_for(&main).pop().unwrap();
    assert!(update.get("meta").is_none(), "{update}");
    live.stop().await;
}

#[tokio::test]
async fn viewer_sends_nothing() {
    let rig = Rig::start(project()).await;
    rig.seed("vera", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("vera", &port).await;
    let main = rig.id(MAIN);
    assert_eq!(port.seen().roles.first(), Some(&(Role::Viewer, false)));
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("vera").contains(&main.0)).await;
    tab.editor.jump(0);
    let (rev, op) = tab.editor.type_text("x").unwrap().unwrap();
    live.editor_change(&tab.doc, rev, op).unwrap();
    tab.pump(&live);
    assert_eq!(tab.editor.content, "Hello");
    assert_eq!(tab.editor.resets, 1);
    assert_eq!(
        live.local_edit_with(&main, |_| Some(TextOperation::new())),
        Err(LiveError::NotWritable)
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rig.mock.received("applyOtUpdate").is_empty());
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    live.stop().await;
}

#[tokio::test]
async fn access_revoked_ends_live_and_keeps_text() {
    let rig = Rig::start(project()).await;
    rig.seed("bob", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("bob", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("bob").contains(&main.0)).await;
    unsent_edit(&rig, &live, &mut tab, " unsent").await;
    rig.mock.set_privilege("bob", None);
    eventually("the session ends", || {
        port.ended() == Some(LiveEnd::Removed)
    })
    .await;
    assert_eq!(kept(&port), vec!["Hello unsent".to_string()]);
    tab.editor.jump(0);
    let (rev, op) = tab.editor.type_text("x").unwrap().unwrap();
    assert_eq!(live.editor_change(&tab.doc, rev, op), Err(LiveError::Ended));
    live.stop().await;
    assert_eq!(port.ended(), Some(LiveEnd::Removed));
    assert!(record_of(&live, &main).is_none());
    assert!(unsent_on(&rig.data("bob"), &rig.mock.base).is_empty());
}

#[tokio::test]
async fn access_revoked_after_link_sharing_off_ends_like_removal() {
    let rig = Rig::start(project().token_viewer(MockUser::named("tess"))).await;
    rig.seed("tess", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("tess", &port).await;
    assert_eq!(port.seen().roles.first(), Some(&(Role::Viewer, false)));
    rig.mock.emit_to_room("project:access:revoked", &[]);
    eventually("the session ends", || {
        port.ended() == Some(LiveEnd::Removed)
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn role_change_reconnects_with_new_role() {
    let rig = Rig::start(project()).await;
    rig.seed("bob", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("bob", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("bob").contains(&main.0)).await;
    let before = rig.connection_of("bob").unwrap();
    rig.mock.set_privilege("bob", Some(Privilege::Review));
    rig.mock.disconnect(&before);
    eventually("the session rejoins as a reviewer", || {
        rig.connection_of("bob").is_some_and(|now| now != before)
            && rig.joined("bob").contains(&main.0)
            && port.seen().roles.last() == Some(&(Role::Reviewer, true))
    })
    .await;
    tab.type_end(&live, " suggested");
    assert!(live.settle(WAIT).await);
    let update = rig.updates_for(&main).pop().unwrap();
    assert!(tracked(&update), "{update}");
    assert_eq!(port.ended(), None);
    live.stop().await;
}

#[tokio::test]
async fn role_downgrade_with_inflight_op_keeps_a_copy() {
    let rig = Rig::start(project()).await;
    rig.seed("bob", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("bob", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("bob").contains(&main.0)).await;
    unsent_edit(&rig, &live, &mut tab, " mine").await;
    rig.mock.set_privilege("bob", Some(Privilege::ReadOnly));
    eventually("the role drops to viewer", || {
        port.seen().roles.last() == Some(&(Role::Viewer, false))
    })
    .await;
    assert_eq!(kept(&port), vec!["Hello mine".to_string()]);
    eventually("the tab shows Overleaf's text again", || {
        tab.text(&live) == "Hello"
    })
    .await;
    assert!(live.unsent(WAIT).await.is_empty());
    assert!(record_of(&live, &main).is_none());
    tab.type_end(&live, " nope");
    assert_eq!(tab.text(&live), "Hello");
    assert_eq!(port.ended(), None);
    live.stop().await;
}

#[tokio::test]
async fn deleted_by_external_source_shows_banner() {
    let rig = Rig::start(project().deleted_by_external_source()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    assert_eq!(port.seen().flags.first(), Some(&(false, true)));
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    tab.type_end(&live, " still live");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello still live");
    assert_eq!(port.ended(), None);
    live.stop().await;
}

#[tokio::test]
async fn project_not_found_on_rejoin_ends_with_project_deleted() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    unsent_edit(&rig, &live, &mut tab, " lost?").await;
    rig.mock
        .configure(|config| config.reject_connections = Some(MockRejection::ProjectNotFound));
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("the session ends", || {
        port.ended() == Some(LiveEnd::ProjectGone)
    })
    .await;
    assert_eq!(kept(&port), vec!["Hello lost?".to_string()]);
    live.stop().await;
    assert!(unsent_on(&rig.data("alice"), &rig.mock.base).is_empty());
}

#[tokio::test]
async fn a_project_removed_from_its_linked_source_stays_live_and_raises_the_flag() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock
        .emit_to_room("projectRenamedOrDeletedByExternalSource", &[]);
    eventually("the flag is raised", || {
        port.seen().flags.last() == Some(&(false, true))
    })
    .await;
    tab.type_end(&live, " still here");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello still here");
    assert_eq!(port.ended(), None);
    live.stop().await;
}

fn joins_of(rig: &Rig, doc: &DocId) -> usize {
    rig.mock
        .received("joinDoc")
        .iter()
        .filter(|received| received.args.first() == Some(&json!(doc.0)))
        .count()
}

fn quiet() -> SessionTuning {
    SessionTuning {
        trickle_every: Duration::from_secs(600),
        ..tuning()
    }
}

fn stopped(port: &Port, doc: &DocId) -> bool {
    port.seen()
        .stopped
        .iter()
        .any(|(stopped, _)| stopped == doc)
}

#[tokio::test]
async fn a_project_deleted_while_live_ends_with_project_deleted() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quiet()).await;
    rig.mock.delete_project();
    let notes = rig.id(NOTES);
    let _tab = Tab::open(&live, NOTES);
    eventually("the session ends as deleted", || {
        port.ended() == Some(LiveEnd::ProjectGone)
    })
    .await;
    assert_eq!(joins_of(&rig, &notes), 1);
    live.stop().await;
}

#[tokio::test]
async fn a_project_deleted_with_unsent_text_keeps_it_as_a_copy_and_stops_no_doc() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quiet()).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    unsent_edit(&rig, &live, &mut tab, " gone?").await;
    rig.mock.delete_project();
    let _notes = Tab::open(&live, NOTES);
    eventually("the session ends as deleted", || {
        port.ended() == Some(LiveEnd::ProjectGone)
    })
    .await;
    assert_eq!(kept(&port), vec!["Hello gone?".to_string()]);
    assert!(port.seen().stopped.is_empty());
    live.stop().await;
    assert!(unsent_on(&rig.data("alice"), &rig.mock.base).is_empty());
}

#[tokio::test]
async fn a_doc_whose_ops_stay_missing_stops_alone() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quiet()).await;
    let notes = rig.id(NOTES);
    rig.mock.lose_ops(&notes.0);
    let before = rig.connection_of("alice").unwrap();
    let _tab = Tab::open(&live, NOTES);
    eventually("the doc stops after one project check", || {
        stopped(&port, &notes)
    })
    .await;
    assert_ne!(rig.connection_of("alice"), Some(before));
    assert_eq!(joins_of(&rig, &notes), 2);
    assert!(port
        .seen()
        .stopped
        .contains(&(notes.clone(), DocStopReason::Fault(DocFault::Unavailable))));
    assert_eq!(port.ended(), None);
    live.stop().await;
}

#[tokio::test]
async fn a_doc_whose_ops_go_missing_stops_and_keeps_its_unsent_text() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quiet()).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    unsent_edit(&rig, &live, &mut tab, " kept?").await;
    rig.mock.lose_ops(&main.0);
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("the doc stops", || stopped(&port, &main)).await;
    assert_eq!(joins_of(&rig, &main), 4);
    assert_eq!(port.ended(), None);
    assert!(kept(&port).is_empty());
    live.stop().await;
    assert_eq!(
        record_of(&live, &main).map(|record| record.local_text),
        Some("Hello kept?".to_string())
    );
}

#[tokio::test]
async fn ops_missing_again_soon_after_a_check_stop_the_doc_without_reconnecting() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live_tuned("alice", &port, quiet()).await;
    let notes = rig.id(NOTES);
    let intro = rig.id(INTRO);
    rig.mock.lose_ops(&notes.0);
    rig.mock.lose_ops(&intro.0);
    let first = rig.connection_of("alice").unwrap();
    let _notes = Tab::open(&live, NOTES);
    eventually("notes stops after one project check", || {
        stopped(&port, &notes)
    })
    .await;
    let checked = rig.connection_of("alice").unwrap();
    assert_ne!(checked, first);
    let _intro = Tab::open(&live, INTRO);
    eventually("intro stops too", || stopped(&port, &intro)).await;
    assert_eq!(rig.connection_of("alice"), Some(checked));
    assert_eq!(joins_of(&rig, &intro), 2);
    assert_eq!(port.ended(), None);
    live.stop().await;
}

#[tokio::test]
async fn not_authorized_with_working_dashboard_is_no_access() {
    let rig = Rig::start(project()).await;
    rig.seed("bob", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("bob", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("bob").contains(&main.0)).await;
    unsent_edit(&rig, &live, &mut tab, " later").await;
    rig.mock
        .configure(|config| config.reject_connections = Some(MockRejection::NotAuthorized));
    rig.mock.drop_client(&rig.connection_of("bob").unwrap());
    eventually("the session ends", || port.ended().is_some()).await;
    assert_eq!(port.ended(), Some(LiveEnd::AccessEnded));
    let parked = port
        .seen()
        .states
        .iter()
        .any(|state| matches!(state, LiveState::SignedOut { .. }));
    assert!(!parked);
    assert!(kept(&port).is_empty());
    live.stop().await;
    assert_eq!(
        record_of(&live, &main).map(|record| record.local_text),
        Some("Hello later".to_string())
    );
}

#[tokio::test]
async fn restricted_user_gets_no_presence() {
    let rig = Rig::start(project().token_viewer(MockUser::named("tess"))).await;
    rig.seed("tess", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("tess", &port).await;
    assert_eq!(port.seen().flags.first(), Some(&(true, false)));
    let main = rig.id(MAIN);
    let _tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("tess").contains(&main.0)).await;
    live.presence(Some((main.clone(), 2)));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(rig
        .mock
        .received("clientTracking.updatePosition")
        .is_empty());
    live.stop().await;
}
