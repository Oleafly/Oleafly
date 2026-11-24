use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use super::super::OverleafSession;
use super::{
    eventually, project, record_of, DocFault, DocStopReason, LiveEnd, LiveError, MergeReview,
    MockProject, MockUser, Port, Privilege, Rig, Tab, FILES, INTRO, MAIN,
};
use crate::live::DocId;

const LONG: usize = 4_005;

async fn opened(rig: &Rig, port: &Arc<Port>) -> (Arc<OverleafSession>, Tab, DocId) {
    rig.seed("alice", 0).await;
    let live = rig.live("alice", port).await;
    let main = rig.id(MAIN);
    let tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    (live, tab, main)
}

fn stopped_with(port: &Port, doc: &DocId, fault: &DocFault) -> bool {
    port.seen()
        .stopped
        .contains(&(doc.clone(), DocStopReason::Fault(fault.clone())))
}

async fn own_fault(message: &str, strikes: usize, fault: DocFault) {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    let intro = rig.id(INTRO);
    let mut other = Tab::open(&live, INTRO);
    eventually("the other doc is joined", || {
        rig.joined("alice").contains(&intro.0)
    })
    .await;
    rig.mock.fail_updates(&main.0, message, strikes);
    tab.type_end(&live, " kept");
    eventually("the doc stops with its fault", || {
        stopped_with(&port, &main, &fault)
    })
    .await;
    assert_eq!(live.text(&main).as_deref(), Some("Hello kept"));
    eventually("the journal keeps the text", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello kept")
    })
    .await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    assert_eq!(rig.updates_for(&main).len(), strikes);
    other.type_end(&live, " still live");
    eventually("the other doc stays live", || {
        rig.mock.doc_text(&intro.0) == "Intro still live"
    })
    .await;
    assert_eq!(port.seen().stopped.len(), 1);
    live.stop().await;
}

#[tokio::test]
async fn fault_delete_mismatch_keeps_text_and_stops_only_that_doc() {
    own_fault(
        "Delete component 'x' does not match deleted text 'y'",
        2,
        DocFault::DeleteMismatch,
    )
    .await;
}

#[tokio::test]
async fn fault_bad_hash_keeps_text_and_stops_only_that_doc() {
    own_fault("Invalid hash", 2, DocFault::BadHash).await;
}

#[tokio::test]
async fn fault_type_mismatch_keeps_text_and_stops_only_that_doc() {
    own_fault("ot type mismatch", 2, DocFault::TypeMismatch).await;
}

#[tokio::test]
async fn fault_refused_keeps_text_and_stops_only_that_doc() {
    own_fault(
        "something new went wrong",
        2,
        DocFault::Refused("something new went wrong".into()),
    )
    .await;
}

#[tokio::test]
async fn fault_too_long_keeps_text_and_stops_only_that_doc() {
    own_fault("Update takes doc over max doc size", 1, DocFault::TooLong).await;
}

#[tokio::test]
async fn fault_too_large_keeps_text_and_stops_only_that_doc() {
    own_fault("update is too large", 1, DocFault::TooLarge).await;
}

#[tokio::test]
async fn fault_too_many_ranges_keeps_text_and_stops_only_that_doc() {
    own_fault(
        "too many comments or tracked changes",
        1,
        DocFault::TooManyRanges,
    )
    .await;
}

#[tokio::test]
async fn fault_unsupported_keeps_text_and_stops_only_that_doc() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    rig.mock.hold_updates();
    tab.type_end(&live, " kept");
    let frame = json!({
        "name": "otUpdateApplied",
        "args": [{
            "doc": main.0,
            "op": [{ "p": 0, "x": "?" }],
            "v": rig.mock.doc_version(&main.0),
            "meta": { "source": "elsewhere", "user_id": rig.user_id("bob"), "ts": 0 },
        }],
    });
    let alice = rig.connection_of("alice").unwrap();
    rig.mock.send_raw(&alice, &format!("5:::{frame}"));
    let fault = DocFault::Unsupported("a change with p, x".into());
    eventually("the doc stops as unsupported", || {
        stopped_with(&port, &main, &fault)
    })
    .await;
    assert_eq!(live.text(&main).as_deref(), Some("Hello kept"));
    rig.mock.release_updates();
    live.stop().await;
}

fn sent_nothing(rig: &Rig, doc: &DocId) -> bool {
    rig.updates_for(doc).is_empty()
}

#[tokio::test]
async fn op_past_2mb_is_never_sent() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    let bob_before = rig.connection_of("bob");
    let big = "a".repeat(2 * 1024 * 1024);
    tab.type_end(&live, &big);
    eventually("the doc stops as too long", || {
        stopped_with(&port, &main, &DocFault::TooLong)
    })
    .await;
    assert!(sent_nothing(&rig, &main));
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    assert_eq!(rig.connection_of("bob"), bob_before);
    assert_eq!(live.text(&main).map(|text| text.len()), Some(5 + big.len()));
    live.stop().await;
}

#[tokio::test]
async fn paste_over_7mb_stays_local() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    let escaped = "\u{1}".repeat(1_300_000);
    tab.type_end(&live, &escaped);
    eventually("the doc stops as too large", || {
        stopped_with(&port, &main, &DocFault::TooLarge)
    })
    .await;
    assert!(sent_nothing(&rig, &main));
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    live.stop().await;
}

#[tokio::test]
async fn a_faulted_doc_never_uploads_whole_file() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    rig.mock.fail_updates(&main.0, "update is too large", 1);
    tab.type_end(&live, " kept");
    eventually("the doc stops", || {
        stopped_with(&port, &main, &DocFault::TooLarge)
    })
    .await;
    let attempts = rig.updates_for(&main).len();
    tab.type_end(&live, " and more");
    eventually("the session is back after the refusal", || {
        rig.connection_of("alice").is_some()
    })
    .await;
    let before = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&before);
    eventually("the session reconnects", || {
        rig.connection_of("alice")
            .is_some_and(|connection| connection != before)
    })
    .await;
    let intro = rig.id(INTRO);
    let mut other = Tab::open(&live, INTRO);
    other.type_end(&live, " live");
    eventually("the other doc still sends", || {
        rig.mock.doc_text(&intro.0) == "Intro live"
    })
    .await;
    assert_eq!(rig.updates_for(&main).len(), attempts);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    assert_eq!(live.text(&main).as_deref(), Some("Hello kept"));
    live.stop().await;
}

fn ranged_project() -> MockProject {
    MockProject::new("ranges")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .doc(MAIN, &"x".repeat(LONG))
        .doc(INTRO, "Intro")
}

fn changes(rig: &Rig, count: usize) -> Value {
    let bob = rig.user_id("bob");
    let list: Vec<Value> = (0..count)
        .map(|at| {
            json!({
                "id": format!("change{at}"),
                "op": { "p": at * 2, "i": "x" },
                "metadata": { "user_id": bob, "ts": "2026-11-15T00:00:00.000Z" },
            })
        })
        .collect();
    json!({ "changes": list })
}

fn comments(count: usize) -> Value {
    let list: Vec<Value> = (0..count)
        .map(|at| {
            json!({
                "id": format!("thread{at}"),
                "op": { "p": at * 2, "c": "x", "t": format!("thread{at}") },
            })
        })
        .collect();
    json!({ "comments": list })
}

#[tokio::test]
async fn too_many_ranges_goes_local_only() {
    let rig = Rig::start(ranged_project().track_changes(json!(true))).await;
    let main = rig.id(MAIN);
    rig.mock.set_ranges(&main.0, changes(&rig, 2_000));
    let text = "x".repeat(LONG);
    let port = Port::new(&[(MAIN, text.as_str()), (INTRO, "Intro")]);
    let (live, mut tab, main) = opened(&rig, &port).await;
    tab.type_end(&live, "y");
    eventually("the doc stops at the range limit", || {
        stopped_with(&port, &main, &DocFault::TooManyRanges)
    })
    .await;
    assert!(sent_nothing(&rig, &main));
    assert_eq!(live.text(&main), Some(format!("{text}y")));
    live.stop().await;
}

#[tokio::test]
async fn doc_with_hundreds_of_comments_stays_live() {
    let rig = Rig::start(ranged_project()).await;
    let main = rig.id(MAIN);
    rig.mock.set_ranges(&main.0, comments(300));
    let text = "x".repeat(LONG);
    let port = Port::new(&[(MAIN, text.as_str()), (INTRO, "Intro")]);
    let (live, mut tab, main) = opened(&rig, &port).await;
    tab.type_end(&live, "y");
    eventually("the typing reaches the server", || {
        rig.mock.doc_text(&main.0) == format!("{text}y")
    })
    .await;
    assert!(port.seen().stopped.is_empty());
    live.stop().await;
}

async fn stranded(rig: &Rig, port: &Arc<Port>) -> (Arc<OverleafSession>, Tab, DocId) {
    let (live, mut tab, main) = opened(rig, port).await;
    rig.mock
        .fail_updates(&main.0, "Delete component does not match", 2);
    tab.type_end(&live, " kept");
    eventually("the doc stops", || {
        stopped_with(port, &main, &DocFault::DeleteMismatch)
    })
    .await;
    (live, tab, main)
}

async fn bob_types_first(rig: &Rig, doc: &DocId) {
    let mut bob = rig.mock.peer("bob");
    bob.join(&doc.0);
    bob.type_at(&doc.0, 0, "Bob: ");
    eventually("bob's edit reaches the server", || {
        rig.mock.doc_text(&doc.0) == "Bob: Hello"
    })
    .await;
}

fn on_disk(port: &Port, text: &str) {
    port.disk
        .lock()
        .unwrap()
        .insert(MAIN.to_string(), text.to_string());
}

#[tokio::test]
async fn try_live_again_merges() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, main) = stranded(&rig, &port).await;
    let intro = rig.id(INTRO);
    let _other = Tab::open(&live, INTRO);
    eventually("the other doc is joined", || {
        rig.joined("alice").contains(&intro.0)
    })
    .await;
    assert_eq!(live.retry(&intro), Err(LiveError::NotWritable));
    bob_types_first(&rig, &main).await;
    on_disk(&port, "Hello kept, then more");
    live.retry(&main).unwrap();
    eventually("the merge reaches the server", || {
        rig.mock.doc_text(&main.0) == "Bob: Hello kept, then more"
    })
    .await;
    assert!(port
        .seen()
        .merged
        .iter()
        .any(|(doc, review)| doc == &main && matches!(review, MergeReview::Merged { .. })));
    assert_eq!(port.seen().stopped.len(), 1);
    live.stop().await;
}

#[tokio::test]
async fn a_trimmed_doc_can_go_live_again() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    tab.type_end(&live, &"a".repeat(2 * 1024 * 1024));
    eventually("the doc stops as too long", || {
        stopped_with(&port, &main, &DocFault::TooLong)
    })
    .await;
    on_disk(&port, "Hello, trimmed");
    live.retry(&main).unwrap();
    eventually("the trimmed text goes live", || {
        rig.mock.doc_text(&main.0) == "Hello, trimmed"
    })
    .await;
    assert_eq!(port.seen().stopped.len(), 1);
    live.stop().await;
}

#[tokio::test]
async fn keep_mine_as_a_copy_reloads_from_overleaf() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, main) = stranded(&rig, &port).await;
    bob_types_first(&rig, &main).await;
    on_disk(&port, "Hello kept");
    live.keep_and_reload(&main).unwrap();
    let kept = MergeReview::Kept {
        text: "Hello kept".into(),
    };
    eventually("the local text is kept as a copy", || {
        port.seen().merged.contains(&(main.clone(), kept.clone()))
    })
    .await;
    eventually("the doc reloads from the server", || {
        live.text(&main).as_deref() == Some("Bob: Hello")
    })
    .await;
    let mut tab = Tab::open(&live, MAIN);
    tab.type_end(&live, " again");
    eventually("the reloaded doc is live", || {
        rig.mock.doc_text(&main.0) == "Bob: Hello again"
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn an_outside_edit_racing_keep_mine_as_a_copy_sends_nothing_stale() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, main) = stranded(&rig, &port).await;
    on_disk(&port, "Hello mine");
    let server = rig.mock.doc_text(&main.0);
    let sent = rig.mock.received("applyOtUpdate").len();
    rig.mock.stall();
    live.keep_and_reload(&main).unwrap();
    on_disk(&port, "Hello kept");
    let edited = live
        .local_edit_with(&main, |current| {
            (current != "Hello mine").then(|| oleafly_ot::diff(current, "Hello mine"))
        })
        .unwrap();
    assert!(
        !edited,
        "the kept text is what the disk holds, so there is nothing to send"
    );
    rig.mock.resume();
    eventually("the doc reloads from the server", || {
        live.text(&main).as_deref() == Some(server.as_str())
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rig.mock.doc_text(&main.0), server);
    assert_eq!(rig.mock.received("applyOtUpdate").len(), sent);
    live.stop().await;
}

#[tokio::test]
async fn external_update_shows_notice() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, main) = opened(&rig, &port).await;
    rig.mock.external_edit(&main.0, 0, "Restored ");
    eventually("the restore arrives", || {
        live.text(&main).as_deref() == Some("Restored Hello")
    })
    .await;
    eventually("the notice is shown", || {
        port.seen().external == vec![main.clone()]
    })
    .await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.type_at(&main.0, 0, "Bob ");
    eventually("an ordinary edit arrives", || {
        live.text(&main).as_deref() == Some("Bob Restored Hello")
    })
    .await;
    assert_eq!(port.seen().external, vec![main.clone()]);
    live.stop().await;
}

#[tokio::test]
async fn replaced_characters_notice_shows_once_per_project() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    let intro = rig.id(INTRO);
    let mut other = Tab::open(&live, INTRO);
    tab.type_end(&live, "\u{0}");
    eventually("the replaced text reaches the server", || {
        rig.mock.doc_text(&main.0) == "Hello\u{fffd}"
    })
    .await;
    other.type_end(&live, "\u{0}");
    eventually("the other replaced text reaches the server", || {
        rig.mock.doc_text(&intro.0) == "Intro\u{fffd}"
    })
    .await;
    assert_eq!(port.seen().replaced, vec![main.clone()]);
    live.stop().await;
}

fn ended_unsupported(port: &Port) -> bool {
    matches!(port.ended(), Some(LiveEnd::Unsupported(_)))
}

#[tokio::test]
async fn one_unreadable_handshake_only_reconnects() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    rig.mock
        .configure(|config| config.permissions_override = Some("archmage".into()));
    let offline = port.offline_count();
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("one handshake is unreadable", || {
        port.offline_count() >= offline + 2
    })
    .await;
    rig.mock
        .configure(|config| config.permissions_override = None);
    tab.type_end(&live, " back");
    eventually("the session is live again", || {
        rig.mock.doc_text(&main.0) == "Hello back"
    })
    .await;
    assert!(port.ended().is_none());
    live.stop().await;
}

#[tokio::test]
async fn three_unreadable_handshakes_in_a_row_end_with_needs_update() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, _main) = opened(&rig, &port).await;
    rig.mock
        .configure(|config| config.permissions_override = Some("archmage".into()));
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("live ends as needing an update", || {
        ended_unsupported(&port)
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn unparseable_frames_after_a_protocol_change_end_with_needs_update() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, main) = opened(&rig, &port).await;
    rig.mock.configure(|config| {
        config.protocol_version = 3;
        config.doc_type_override = Some("sharejs-json".into());
    });
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("live ends as needing an update", || {
        ended_unsupported(&port)
    })
    .await;
    assert!(stopped_with(
        &port,
        &main,
        &DocFault::Unsupported("sharejs-json".into())
    ));
    live.stop().await;
}

#[tokio::test]
async fn a_protocol_change_with_readable_docs_stays_live() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port).await;
    rig.mock.configure(|config| config.protocol_version = 3);
    let before = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&before);
    eventually("the session rejoins", || {
        rig.connection_of("alice")
            .is_some_and(|connection| connection != before)
    })
    .await;
    tab.type_end(&live, " after");
    eventually("typing still reaches the server", || {
        rig.mock.doc_text(&main.0) == "Hello after"
    })
    .await;
    assert!(port.ended().is_none());
    assert!(port.seen().stopped.is_empty());
    live.stop().await;
}
