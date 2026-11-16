use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use oleafly_ot::DocSink;

use super::super::pacing::JoinPacer;
use super::super::{LiveEnd, LiveError, LivePort, OverleafSession, Resolution, SessionTuning};
use super::{
    eventually, project, record_of, tuning, LiveState, MergeReview, MockFormat, MockRejection,
    Port, Rig, Tab, FILES, MAIN, NOTES, WAIT,
};
use crate::error::OnlineErrorKind;
use crate::live::DocId;
use crate::realtime::connection::Carrier;
use crate::realtime::ProjectPage;
use crate::test_support::mock_overleaf::MockPeer;

static SKEW_MS: AtomicU64 = AtomicU64::new(0);

fn skewed_clock() -> SystemTime {
    SystemTime::now() + Duration::from_millis(SKEW_MS.load(Ordering::SeqCst))
}

async fn opened(
    rig: &Rig,
    port: &Arc<Port>,
    tuning: SessionTuning,
) -> (Arc<OverleafSession>, Tab, DocId) {
    rig.seed("alice", 0).await;
    let live = rig.live_tuned("alice", port, tuning).await;
    let main = rig.id(MAIN);
    let tab = Tab::open(&live, MAIN);
    joined(rig, &main).await;
    (live, tab, main)
}

async fn joined(rig: &Rig, doc: &DocId) {
    eventually("the doc is joined", || rig.joined("alice").contains(&doc.0)).await;
}

async fn reconnected(rig: &Rig, before: &str) {
    eventually("alice is back on a new connection", || {
        rig.connection_of("alice").is_some_and(|now| now != before)
    })
    .await;
}

fn refuse(rig: &Rig, rejection: Option<MockRejection>) {
    rig.mock
        .configure(|config| config.reject_connections = rejection);
}

async fn cut_off(rig: &Rig, port: &Port) {
    let before = rig.connection_of("alice").unwrap();
    refuse(rig, Some(MockRejection::Retry));
    rig.mock.drop_client(&before);
    eventually("a reconnect was refused", || port.offline_count() >= 2).await;
}

fn type_at_end(rig: &Rig, bob: &mut MockPeer, doc: &DocId, text: &str) {
    let end = rig.mock.doc_text(&doc.0).len();
    bob.type_at(&doc.0, end, text);
}

fn sent_by_alice(rig: &Rig, bob: &MockPeer) -> usize {
    rig.mock
        .received("applyOtUpdate")
        .into_iter()
        .filter(|received| received.public_id != bob.public_id)
        .count()
}

fn idled(port: &Port) -> usize {
    port.seen()
        .states
        .iter()
        .filter(|state| **state == LiveState::Idle)
        .count()
}

async fn conflicted(rig: &Rig, port: &Arc<Port>) -> (Arc<OverleafSession>, Tab, DocId, MockPeer) {
    rig.mock.configure(|config| config.kept_ops = 1);
    let (live, mut tab, main) = opened(rig, port, tuning()).await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    cut_off(rig, port).await;
    tab.type_end(&live, " there");
    type_at_end(rig, &mut bob, &main, " wor");
    type_at_end(rig, &mut bob, &main, "ld");
    refuse(rig, None);
    let review = MergeReview::NeedsReview {
        mine: "Hello there".into(),
        theirs: "Hello world".into(),
    };
    eventually("the conflict is listed", || {
        port.seen().merged.contains(&(main.clone(), review.clone()))
    })
    .await;
    (live, tab, main, bob)
}

#[tokio::test]
async fn resume_after_drop_sends_each_op_once() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port, tuning()).await;
    let notes = rig.id(NOTES);
    let mut other = Tab::open(&live, NOTES);
    joined(&rig, &notes).await;
    rig.mock.stall();
    tab.type_end(&live, " one");
    eventually("the edit reached the server", || {
        rig.mock.doc_text(&main.0) == "Hello one"
    })
    .await;
    tab.type_end(&live, " three");
    other.type_end(&live, " two");
    let before = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&before);
    rig.mock.resume();
    reconnected(&rig, &before).await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello one three");
    assert_eq!(rig.mock.doc_text(&notes.0), "Notes two");
    assert_eq!(tab.text(&live), "Hello one three");
    assert_eq!(other.text(&live), "Notes two");
    live.stop().await;
}

#[tokio::test]
async fn missing_ops_falls_back_to_three_way_merge() {
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| config.kept_ops = 2);
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port, tuning()).await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    cut_off(&rig, &port).await;
    tab.type_at(&live, 0, "Oh, ");
    for word in [" a", " b", " c", " d"] {
        type_at_end(&rig, &mut bob, &main, word);
    }
    refuse(&rig, None);
    eventually("the merge reaches the editor", || {
        tab.text(&live) == "Oh, Hello a b c d"
    })
    .await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Oh, Hello a b c d");
    let merged = MergeReview::Merged {
        before: "Oh, Hello".into(),
        after: "Oh, Hello a b c d".into(),
    };
    assert!(port.seen().merged.contains(&(main.clone(), merged)));
    assert_eq!(sent_by_alice(&rig, &bob), 1);
    live.stop().await;
}

#[tokio::test]
async fn format_changed_to_history_ot_while_offline_merges() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port, tuning()).await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    cut_off(&rig, &port).await;
    tab.type_at(&live, 0, "Oh, ");
    type_at_end(&rig, &mut bob, &main, " world");
    rig.mock.set_doc_format(&main.0, MockFormat::HistoryOt);
    refuse(&rig, None);
    eventually("the merge reaches the editor", || {
        tab.text(&live) == "Oh, Hello world"
    })
    .await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Oh, Hello world");
    tab.type_end(&live, "!");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Oh, Hello world!");
    live.stop().await;
}

#[tokio::test]
async fn a_conflicting_offline_edit_shows_both_copies() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main, _bob) = conflicted(&rig, &port).await;
    assert_eq!(tab.text(&live), "Hello there");
    assert_eq!(live.text(&main).as_deref(), Some("Hello there"));
    assert_eq!(rig.mock.doc_text(&main.0), "Hello world");
    live.stop().await;
}

#[tokio::test]
async fn an_overlapping_merge_needs_review_and_never_applies_silently() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main, mut bob) = conflicted(&rig, &port).await;
    type_at_end(&rig, &mut bob, &main, " again");
    tab.type_end(&live, "?");
    assert!(!live.settle(Duration::from_millis(500)).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello world again");
    assert_eq!(tab.text(&live), "Hello there?");
    assert_eq!(sent_by_alice(&rig, &bob), 0);
    eventually("the held text is journaled", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello there?")
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn use_mine_sends_ops_on_top_of_overleaf() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main, bob) = conflicted(&rig, &port).await;
    live.resolve(&main, Resolution::Mine).unwrap();
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello there");
    assert_eq!(tab.text(&live), "Hello there");
    assert_eq!(sent_by_alice(&rig, &bob), 1);
    assert!(!port
        .seen()
        .merged
        .iter()
        .any(|(_, review)| matches!(review, MergeReview::Kept { .. })));
    tab.type_end(&live, "!");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello there!");
    live.stop().await;
}

#[tokio::test]
async fn use_overleafs_keeps_mine_as_a_copy() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main, bob) = conflicted(&rig, &port).await;
    live.resolve(&main, Resolution::Theirs).unwrap();
    let kept = MergeReview::Kept {
        text: "Hello there".into(),
    };
    assert!(port.seen().merged.contains(&(main.clone(), kept)));
    eventually("the editor shows the server's text", || {
        tab.text(&live) == "Hello world"
    })
    .await;
    assert!(live.settle(WAIT).await);
    assert_eq!(sent_by_alice(&rig, &bob), 0);
    assert_eq!(
        live.resolve(&main, Resolution::Mine),
        Err(LiveError::NotWritable)
    );
    tab.type_end(&live, " ok");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello world ok");
    live.stop().await;
}

#[tokio::test]
async fn graceful_reconnect_waits_for_typing_pause() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let pause = Duration::from_millis(400);
    let tuned = SessionTuning {
        typing_pause: pause,
        ..tuning()
    };
    let (live, mut tab, main) = opened(&rig, &port, tuned).await;
    let before = rig.connection_of("alice").unwrap();
    tab.type_end(&live, ".");
    rig.mock.reconnect_gracefully();
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        tab.type_end(&live, ".");
        assert_eq!(rig.connection_of("alice").as_deref(), Some(before.as_str()));
    }
    let stopped = Instant::now();
    reconnected(&rig, &before).await;
    assert!(stopped.elapsed() >= pause - Duration::from_millis(50));
    assert!(live.settle(WAIT).await);
    assert_eq!(
        rig.mock.doc_text(&main.0),
        format!("Hello{}", ".".repeat(11))
    );
    live.stop().await;
}

#[tokio::test]
async fn drain_uses_the_page_interval_when_set() {
    let rig = Rig::start(project()).await;
    rig.mock
        .configure(|config| config.max_reconnect_gracefully_ms = Some(600));
    let port = Port::new(&FILES);
    let tuned = SessionTuning {
        typing_pause: Duration::from_secs(10),
        ..tuning()
    };
    let (live, mut tab, main) = opened(&rig, &port, tuned).await;
    let before = rig.connection_of("alice").unwrap();
    tab.type_end(&live, ".");
    rig.mock.reconnect_gracefully();
    let drained = Instant::now();
    let mut typed = 1;
    while rig.connection_of("alice").as_deref() == Some(before.as_str()) {
        assert!(
            drained.elapsed() < Duration::from_secs(5),
            "the drain never came"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        tab.type_end(&live, ".");
        typed += 1;
    }
    let elapsed = drained.elapsed();
    assert!(elapsed >= Duration::from_millis(500), "{elapsed:?}");
    assert!(elapsed < Duration::from_millis(2_500), "{elapsed:?}");
    reconnected(&rig, &before).await;
    assert!(live.settle(WAIT).await);
    assert_eq!(
        rig.mock.doc_text(&main.0),
        format!("Hello{}", ".".repeat(typed))
    );
    live.stop().await;
}

#[tokio::test]
async fn force_disconnect_shows_message_and_counts_down() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port, tuning()).await;
    let before = rig.connection_of("alice").unwrap();
    rig.mock.force_disconnect("Back <b>soon</b>", 1);
    let started = Instant::now();
    eventually("the maintenance notice arrives", || {
        port.seen().maintenance == vec![("Back <b>soon</b>".to_string(), Duration::from_secs(1))]
    })
    .await;
    live.reconnect_now();
    tab.type_end(&live, " later");
    reconnected(&rig, &before).await;
    assert!(started.elapsed() >= Duration::from_millis(900));
    assert!(port.seen().states.iter().any(|state| matches!(
        state,
        LiveState::Offline { retry_in, .. } if *retry_in >= Duration::from_secs(1)
    )));
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello later");
    live.stop().await;
}

#[tokio::test]
async fn idle_disconnects_only_with_nothing_pending() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let tuned = SessionTuning {
        idle_after: Duration::from_millis(300),
        ..tuning()
    };
    let (live, mut tab, main) = opened(&rig, &port, tuned).await;
    let before = rig.connection_of("alice").unwrap();
    live.set_focused(false);
    rig.mock.hold_updates();
    tab.type_end(&live, " held");
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert_eq!(rig.connection_of("alice").as_deref(), Some(before.as_str()));
    assert_eq!(idled(&port), 0);
    rig.mock.release_updates();
    eventually("alice rests", || {
        idled(&port) == 1 && rig.connection_of("alice").is_none()
    })
    .await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello held");
    live.stop().await;
}

#[tokio::test]
async fn focus_reconnects_from_idle_and_catches_up() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let tuned = SessionTuning {
        idle_after: Duration::from_millis(300),
        ..tuning()
    };
    let (live, mut tab, main) = opened(&rig, &port, tuned).await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    live.set_focused(false);
    eventually("alice rests", || idled(&port) == 1).await;
    type_at_end(&rig, &mut bob, &main, " from bob");
    live.set_focused(true);
    eventually("bob's edit reaches alice", || {
        tab.text(&live) == "Hello from bob"
    })
    .await;
    assert!(matches!(
        port.seen().states.last(),
        Some(LiveState::Online { .. })
    ));
    live.set_focused(false);
    eventually("alice rests again", || idled(&port) == 2).await;
    tab.type_end(&live, ", typed");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello from bob, typed");
    live.stop().await;
}

#[tokio::test]
async fn sleep_detected_by_clock_jump() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let mut tuned = tuning();
    tuned.connection.wall_clock = skewed_clock;
    tuned.connection.tick = Duration::from_millis(50);
    let (live, mut tab, main) = opened(&rig, &port, tuned).await;
    rig.mock.stall();
    tab.type_end(&live, " before sleep");
    eventually("the server applied it", || {
        rig.mock.doc_text(&main.0) == "Hello before sleep"
    })
    .await;
    let before = rig.connection_of("alice").unwrap();
    SKEW_MS.fetch_add(60_000, Ordering::SeqCst);
    eventually("the jump drops the connection", || port.went_offline()).await;
    rig.mock.resume();
    reconnected(&rig, &before).await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello before sleep");
    tab.type_end(&live, ", after");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello before sleep, after");
    live.stop().await;
}

#[tokio::test]
async fn rate_limited_rejection_waits_fifteen_seconds() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, _main) = opened(&rig, &port, tuning()).await;
    let before = rig.connection_of("alice").unwrap();
    refuse(&rig, Some(MockRejection::RateLimited));
    rig.mock.drop_client(&before);
    eventually("the rate limit sets the wait", || {
        port.seen().states.iter().any(|state| {
            matches!(
                state,
                LiveState::Offline { retry_in, .. } if *retry_in >= Duration::from_secs(15)
            )
        })
    })
    .await;
    refuse(&rig, None);
    live.reconnect_now();
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(rig.connection_of("alice"), None);
    live.stop().await;
}

#[tokio::test]
async fn reconnect_now_skips_the_backoff_wait() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, _tab, _main) = opened(&rig, &port, tuning()).await;
    let before = rig.connection_of("alice").unwrap();
    refuse(&rig, Some(MockRejection::Retry));
    rig.mock.drop_client(&before);
    let long = Duration::from_millis(1_500);
    eventually("a long backoff is scheduled", || {
        matches!(
            port.seen().states.last(),
            Some(LiveState::Offline { retry_in, .. }) if *retry_in >= long
        )
    })
    .await;
    refuse(&rig, None);
    let nudged = Instant::now();
    live.reconnect_now();
    reconnected(&rig, &before).await;
    assert!(nudged.elapsed() < long - Duration::from_millis(500));
    live.stop().await;
}

#[test]
fn the_join_pacer_keeps_joins_under_the_limit() {
    let start = tokio::time::Instant::now();
    let at = |seconds: u64| start + Duration::from_secs(seconds);
    let mut pacer = JoinPacer::new(3, Duration::from_secs(60));
    for second in 0..3 {
        assert_eq!(pacer.delay(at(second)), Duration::ZERO);
        pacer.record(at(second));
    }
    assert_eq!(pacer.delay(at(10)), Duration::from_secs(50));
    assert_eq!(pacer.delay(at(59)), Duration::from_secs(1));
    assert_eq!(pacer.delay(at(60)), Duration::ZERO);
}

#[tokio::test]
async fn reconnects_paced_under_join_limit() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let window = Duration::from_secs(3);
    let tuned = SessionTuning {
        join_limit: 2,
        join_window: window,
        ..tuning()
    };
    let started = Instant::now();
    let (live, _tab, _main) = opened(&rig, &port, tuned).await;
    let first = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&first);
    reconnected(&rig, &first).await;
    let second = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&second);
    reconnected(&rig, &second).await;
    assert!(started.elapsed() >= window - Duration::from_millis(100));
    live.stop().await;
}

#[tokio::test]
async fn a_doc_error_from_someone_else_rejoins_quietly() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port, tuning()).await;
    let before = rig.connection_of("alice").unwrap();
    rig.mock
        .doc_error(&main.0, "Delete component does not match");
    reconnected(&rig, &before).await;
    joined(&rig, &main).await;
    tab.type_end(&live, " fine");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello fine");
    assert!(port.seen().stopped.is_empty());
    assert!(port.seen().unsteady.is_empty());
    rig.mock
        .doc_error(&main.0, "Delete component does not match");
    eventually("a repeat is reported once", || {
        port.seen().unsteady == vec![main.clone()]
    })
    .await;
    assert!(port.seen().stopped.is_empty());
    live.stop().await;
}

#[tokio::test]
async fn an_unconfirmed_change_is_flagged_until_the_server_confirms_it() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let tuned = SessionTuning {
        slow_ack_after: Duration::from_millis(300),
        ..tuning()
    };
    let (live, mut tab, main) = opened(&rig, &port, tuned).await;
    rig.mock.hold_updates();
    tab.type_end(&live, " slow");
    eventually("the wait is flagged", || {
        port.seen().slow_acks == vec![true]
    })
    .await;
    rig.mock.release_updates();
    eventually("the flag clears", || {
        port.seen().slow_acks == vec![true, false]
    })
    .await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello slow");
    live.stop().await;
}

#[tokio::test]
async fn quit_settles_or_journals_every_doc() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, main) = opened(&rig, &port, tuning()).await;
    tab.type_end(&live, " saved");
    assert!(live.settle(WAIT).await);
    rig.mock.stall();
    tab.type_end(&live, " unsent");
    assert!(!live.settle(Duration::from_millis(200)).await);
    live.stop().await;
    let record = record_of(&live, &main).expect("the unsent edit is journaled");
    assert_eq!(record.local_text, "Hello saved unsent");
    drop(live);
    rig.mock.resume();
    let again = Port::new(&FILES);
    let live = rig.live("alice", &again).await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello saved unsent");
    assert!(record_of(&live, &main).is_none());
    live.stop().await;
}

#[tokio::test]
async fn connection_details_contain_no_secrets() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let (live, mut tab, _main) = opened(&rig, &port, tuning()).await;
    let alice = rig.mock.user("alice");
    let page = ProjectPage::load(
        &rig.http,
        &rig.handle_for(&alice),
        &rig.mock.project_id(),
        false,
    )
    .await
    .unwrap();
    let csrf = page.csrf().expect("the page has a CSRF token");
    rig.mock.hold_updates();
    tab.type_end(&live, " pending");
    let details = live.details();
    assert_eq!(details.server, rig.http.url(""));
    assert_eq!(
        details.transport.as_deref(),
        Some(Carrier::WebSocket.wire_name())
    );
    assert_eq!(details.public_id, rig.connection_of("alice"));
    assert_eq!(details.pending_docs, vec![MAIN.to_string()]);
    rig.mock.release_updates();
    let before = rig.connection_of("alice").unwrap();
    refuse(&rig, Some(MockRejection::Retry));
    rig.mock.drop_client(&before);
    eventually("the refusal is recorded", || {
        live.details().last_rejection.is_some()
    })
    .await;
    refuse(&rig, None);
    let copied = serde_json::to_string(&live.details()).unwrap();
    assert!(!copied.contains(&alice.session), "{copied}");
    assert!(!copied.contains(&csrf), "{copied}");
    live.stop().await;
}

async fn restarted(rig: &Rig, port: &Arc<Port>) -> Arc<OverleafSession> {
    let journal = rig.journal("alice").await;
    let shared = Arc::clone(port) as Arc<dyn LivePort>;
    OverleafSession::start(rig.config("alice", tuning()), shared, journal)
        .await
        .unwrap()
}

async fn went_live_once(rig: &Rig) {
    let port = Port::new(&FILES);
    let (live, _tab, _main) = opened(rig, &port, tuning()).await;
    live.stop().await;
}

#[tokio::test]
async fn a_restart_offline_opens_editors_and_journals_from_the_first_keystroke() {
    let rig = Rig::start(project()).await;
    went_live_once(&rig).await;
    rig.mock.crash();
    let port = Port::new(&FILES);
    let started = Instant::now();
    let live = restarted(&rig, &port).await;
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(!live.nodes().is_empty());
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    assert_eq!(tab.text(&live), "Hello");
    tab.type_end(&live, " offline");
    eventually("the first keystrokes are journaled", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello offline")
    })
    .await;
    assert!(!port
        .seen()
        .states
        .iter()
        .any(|state| matches!(state, LiveState::Online { .. })));
    rig.mock.recover();
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello offline");
    assert_eq!(tab.text(&live), "Hello offline");
    live.stop().await;
}

#[tokio::test]
async fn a_first_start_while_offline_keeps_trying_in_the_background() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    rig.mock.crash();
    let port = Port::new(&FILES);
    let live = restarted(&rig, &port).await;
    let ignore: DocSink = Arc::new(|_| {});
    assert!(live.nodes().is_empty());
    assert!(live.open(MAIN, ignore).is_none());
    rig.mock.recover();
    eventually("the first join arrives", || !live.nodes().is_empty()).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    joined(&rig, &main).await;
    tab.type_end(&live, " later");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello later");
    live.stop().await;
}

#[tokio::test]
async fn a_refused_first_start_fails() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    refuse(&rig, Some(MockRejection::ProjectNotFound));
    let journal = rig.journal("alice").await;
    let port = Port::new(&FILES) as Arc<dyn LivePort>;
    let started = OverleafSession::start(rig.config("alice", tuning()), port, journal).await;
    let error = started.err().expect("the start is refused");
    assert_eq!(error.kind, OnlineErrorKind::ProjectUnavailable);
}

#[tokio::test]
async fn a_refusal_after_an_offline_start_ends_the_session() {
    let rig = Rig::start(project()).await;
    went_live_once(&rig).await;
    refuse(&rig, Some(MockRejection::ProjectNotFound));
    let port = Port::new(&FILES);
    let live = restarted(&rig, &port).await;
    eventually("the refusal ends the session", || {
        port.ended() == Some(LiveEnd::ProjectGone)
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn a_viewers_keystroke_before_the_first_join_never_shows() {
    let rig = Rig::start(project()).await;
    rig.seed("vera", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("vera", &port).await;
    rig.mock.stall();
    let mut tab = Tab::open(&live, MAIN);
    tab.editor.jump(0);
    let (rev, op) = tab.editor.type_text("x").unwrap().unwrap();
    live.editor_change(&tab.doc, rev, op).unwrap();
    tab.pump(&live);
    assert_eq!(tab.editor.content, "Hello");
    rig.mock.resume();
    let main = rig.id(MAIN);
    eventually("the doc is joined", || rig.joined("vera").contains(&main.0)).await;
    assert_eq!(tab.text(&live), "Hello");
    assert!(rig.mock.received("applyOtUpdate").is_empty());
    live.stop().await;
}
