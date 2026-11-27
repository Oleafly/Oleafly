use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;

use serde_json::Value;

use super::super::state::State;
use super::super::{Account, LivePort, OverleafSession, ReviewWriteError, SessionTuning, Standing};
use super::{eventually, tuning, Port, Rig, Tab, MAIN, NOTES, WAIT};
use crate::live::journal::Journal;
use crate::live::rest::{RestError, ReviewError};
use crate::realtime::events::{AccessEvent, ChatEvent, ReviewUser, ServerEvent};
use crate::realtime::project::{ProjectState, Role};
use crate::test_support::mock_overleaf::{Fault, MockProject, MockUser, Privilege};
use crate::test_support::overleaf_rt::{probe, recordings};

fn chat_project() -> MockProject {
    MockProject::new("chat")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("tess"))
        .doc(MAIN, "Hello")
        .doc(NOTES, "Notes")
}

async fn chat_live(rig: &Rig, name: &str, port: &Arc<Port>) -> Arc<OverleafSession> {
    chat_live_tuned(rig, name, port, tuning()).await
}

async fn chat_live_tuned(
    rig: &Rig,
    name: &str,
    port: &Arc<Port>,
    tuned: SessionTuning,
) -> Arc<OverleafSession> {
    rig.seed(name, 0).await;
    let live = rig.live_tuned(name, port, tuned).await;
    eventually("chat support is known", || live.chat_support().probed).await;
    live
}

fn messages_route(rig: &Rig) -> String {
    format!("/project/{}/messages", rig.mock.project_id())
}

fn chat_reads(rig: &Rig) -> usize {
    rig.mock
        .requests(&messages_route(rig))
        .iter()
        .filter(|request| request.method == "GET")
        .count()
}

async fn page(live: &OverleafSession, limit: usize) -> Vec<(String, bool)> {
    live.chat_page(None, limit)
        .await
        .unwrap()
        .into_iter()
        .map(|entry| (entry.message.content, entry.deleted))
        .collect()
}

fn others_since(port: &Port, from: usize) -> bool {
    port.seen().chat[from..].iter().any(|change| !change.local)
}

#[tokio::test]
async fn own_echo_not_duplicated() {
    let rig = Rig::start(chat_project()).await;
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    eventually("the newest page arrived", || chat_reads(&rig) >= 1).await;
    assert!(live.chat_support().available);
    let before = port.seen().chat.len();
    let sent = live.send_chat("Hello $x$").await.unwrap();
    assert!(!sent.pending);
    assert!(!sent.deleted);
    assert_eq!(sent.message.content, "Hello $x$");
    assert_eq!(sent.message.user_id, Some(rig.user_id("alice")));
    assert_eq!(rig.mock.chat_messages()[0]["id"], json!(sent.message.id));
    let posted = rig
        .mock
        .requests(&messages_route(&rig))
        .into_iter()
        .find(|request| request.method == "POST")
        .unwrap();
    let body: serde_json::Value = serde_json::from_str(&posted.body).unwrap();
    assert_eq!(body["content"], "Hello $x$");
    assert_eq!(body["client_id"].as_str().map(str::len), Some(36));
    assert_eq!(
        page(&live, 50).await,
        vec![("Hello $x$".to_string(), false)]
    );
    eventually("the change was told", || port.seen().chat.len() > before).await;
    assert!(!others_since(&port, before));
    live.stop().await;
}

#[tokio::test]
async fn edit_delete_events_apply() {
    let rig = Rig::start(chat_project()).await;
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    eventually("the newest page arrived", || chat_reads(&rig) >= 1).await;
    let bob = rig.mock.peer("bob");
    let before = port.seen().chat.len();
    assert_eq!(bob.post_chat("From Bob", None).status, 204);
    eventually("bob's message arrives", || {
        port.seen().chat[before..]
            .iter()
            .any(|change| !change.local)
    })
    .await;
    let id = live.chat_page(None, 10).await.unwrap()[0]
        .message
        .id
        .clone();
    assert_eq!(bob.edit_chat(&id, "From Bob, edited").status, 204);
    let mut edited = None;
    eventually("the edit applies", || {
        edited = futures_util::FutureExt::now_or_never(live.chat_page(None, 10))
            .and_then(Result::ok)
            .and_then(|entries| entries.into_iter().next());
        edited
            .as_ref()
            .is_some_and(|entry| entry.message.content == "From Bob, edited")
    })
    .await;
    assert!(edited.unwrap().message.edited_at.is_some());
    assert_eq!(bob.delete_chat(&id).status, 204);
    eventually("the delete applies", || {
        futures_util::FutureExt::now_or_never(live.chat_page(None, 10))
            .and_then(Result::ok)
            .is_some_and(|entries| entries.len() == 1 && entries[0].deleted)
    })
    .await;
    let gone = live.chat_page(None, 10).await.unwrap().remove(0);
    assert!(gone.message.content.is_empty());
    assert_eq!(
        live.edit_chat(&id, "again").await,
        Err(ReviewWriteError::Gone)
    );
    let mine = live.send_chat("Mine").await.unwrap();
    let edited = live
        .edit_chat(&mine.message.id, "Mine, edited")
        .await
        .unwrap();
    assert_eq!(edited.message.content, "Mine, edited");
    assert!(edited.message.edited_at.is_some());
    assert_eq!(rig.mock.chat_messages()[0]["content"], "Mine, edited");
    let dave = rig.mock.peer("dave");
    assert_eq!(dave.post_chat("A viewer", None).status, 204);
    let from_dave = rig.mock.chat_messages()[1]["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        live.delete_chat(&from_dave).await,
        Err(ReviewWriteError::NotAllowed)
    );
    live.delete_chat(&mine.message.id).await.unwrap();
    assert_eq!(rig.mock.chat_messages().as_array().unwrap().len(), 1);
    live.stop().await;
}

#[tokio::test]
async fn chat_reconnect_dedup() {
    let rig = Rig::start(chat_project()).await;
    let bob = rig.mock.peer("bob");
    for text in ["one", "two", "three"] {
        assert_eq!(bob.post_chat(text, None).status, 204);
    }
    let ids: Vec<String> = rig
        .mock
        .chat_messages()
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["id"].as_str().unwrap().to_string())
        .collect();
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    eventually("the first page is in", || chat_reads(&rig) >= 1).await;
    assert_eq!(
        page(&live, 50).await,
        vec![
            ("one".to_string(), false),
            ("two".to_string(), false),
            ("three".to_string(), false)
        ]
    );
    let reads = chat_reads(&rig);
    let first = rig.connection_of("alice").unwrap();
    rig.mock.hold_room_events();
    assert_eq!(bob.delete_chat(&ids[0]).status, 204);
    assert_eq!(bob.edit_chat(&ids[1], "two, edited").status, 204);
    assert_eq!(bob.post_chat("four", None).status, 204);
    rig.mock.disconnect(&first);
    rig.mock.release_room_events();
    eventually("a new connection", || {
        rig.connection_of("alice").is_some_and(|id| id != first)
    })
    .await;
    eventually("the newest page is read again", || chat_reads(&rig) > reads).await;
    eventually("the refetch is merged", || {
        futures_util::FutureExt::now_or_never(page(&live, 50))
            == Some(vec![
                (String::new(), true),
                ("two, edited".to_string(), false),
                ("three".to_string(), false),
                ("four".to_string(), false),
            ])
    })
    .await;
    assert_eq!(chat_reads(&rig), reads + 1);
    live.stop().await;
}

#[tokio::test]
async fn older_pages_page_by_timestamp_from_cache() {
    let rig = Rig::start(chat_project()).await;
    rig.mock
        .configure(|config| config.rate_limits.chat_messages_per_minute = 120);
    let bob = rig.mock.peer("bob");
    for n in 0..120 {
        assert_eq!(bob.post_chat(&format!("m{n:03}"), None).status, 204);
    }
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    eventually("the first page is in", || chat_reads(&rig) >= 1).await;
    let reads = chat_reads(&rig);
    let newest = live.chat_page(None, 50).await.unwrap();
    assert_eq!(newest.len(), 50);
    assert_eq!(newest[0].message.content, "m070");
    assert_eq!(newest[49].message.content, "m119");
    assert_eq!(chat_reads(&rig), reads);
    let older = live
        .chat_page(Some(&newest[0].message.id), 50)
        .await
        .unwrap();
    assert_eq!(older.len(), 50);
    assert_eq!(older[0].message.content, "m020");
    assert_eq!(older[49].message.content, "m069");
    assert_eq!(chat_reads(&rig), reads + 1);
    let again = live
        .chat_page(Some(&newest[0].message.id), 50)
        .await
        .unwrap();
    assert_eq!(again, older);
    assert_eq!(chat_reads(&rig), reads + 1);
    let start = live
        .chat_page(Some(&older[0].message.id), 50)
        .await
        .unwrap();
    assert_eq!(start.len(), 20);
    assert_eq!(start[0].message.content, "m000");
    let reads = chat_reads(&rig);
    assert!(live
        .chat_page(Some(&start[0].message.id), 50)
        .await
        .unwrap()
        .is_empty());
    let all = live.chat_page(None, 200).await.unwrap();
    assert_eq!(all.len(), 120);
    assert_eq!(chat_reads(&rig), reads);
    assert_eq!(
        live.chat_page(Some("6b04fdd5296ea5fec7324e27"), 10).await,
        Err(ReviewWriteError::Gone)
    );
    live.stop().await;
}

#[tokio::test]
async fn chat_off_server_hides_chat() {
    let rig = Rig::start(chat_project()).await;
    rig.mock.configure(|config| config.chat = false);
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    assert!(!live.chat_support().available);
    assert_eq!(
        live.chat_page(None, 10).await,
        Err(ReviewWriteError::Absent)
    );
    assert_eq!(live.send_chat("hi").await, Err(ReviewWriteError::Absent));
    assert!(rig
        .mock
        .requests(&messages_route(&rig))
        .iter()
        .all(|request| request.method == "GET"));
    live.stop().await;
}

#[tokio::test]
async fn restricted_user_gets_no_chat() {
    let rig = Rig::start(chat_project()).await;
    let port = Port::new(&[]);
    let live = chat_live(&rig, "tess", &port).await;
    assert!(!live.chat_support().available);
    assert_eq!(
        live.send_chat("hi").await,
        Err(ReviewWriteError::Restricted)
    );
    assert_eq!(
        live.chat_page(None, 10).await,
        Err(ReviewWriteError::Restricted)
    );
    let bob = rig.mock.peer("bob");
    assert_eq!(bob.post_chat("hidden from links", None).status, 204);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rig.mock.requests(&messages_route(&rig)).is_empty());
    assert!(port
        .seen()
        .chat
        .iter()
        .all(|change| !change.support || change.trouble.is_none()));
    live.stop().await;
}

#[tokio::test]
async fn a_viewer_chats_and_an_echo_that_never_comes_is_found_by_reading() {
    let rig = Rig::start(chat_project()).await;
    let port = Port::new(&[]);
    let live = chat_live(&rig, "dave", &port).await;
    eventually("the first page is in", || chat_reads(&rig) >= 1).await;
    rig.mock.hold_room_events();
    let started = Instant::now();
    let sent = live.send_chat("Seen by reading").await.unwrap();
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(!sent.pending);
    assert_eq!(rig.mock.chat_messages()[0]["id"], json!(sent.message.id));
    rig.mock.release_room_events();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let listed = live.chat_page(None, 10).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].message.id, sent.message.id);
    live.stop().await;
}

#[tokio::test]
async fn a_stalled_chat_route_returns_within_the_bound() {
    let rig = Rig::start(chat_project()).await;
    let port = Port::new(&[]);
    let mut tuned = tuning();
    tuned.review_deadline = Duration::from_millis(400);
    let live = chat_live_tuned(&rig, "alice", &port, tuned).await;
    let route = messages_route(&rig);
    rig.mock
        .plan_fault(Some("POST"), &route, Fault::Delay(Duration::from_secs(600)));
    let started = Instant::now();
    let sent = live.send_chat("stuck").await;
    assert_eq!(
        sent,
        Err(ReviewWriteError::Rest(ReviewError::TimedOut(
            Duration::from_millis(400)
        )))
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    rig.mock
        .plan_fault(Some("GET"), &route, Fault::Delay(Duration::from_secs(600)));
    let started = Instant::now();
    let paged = live.chat_page(Some("unknown"), 10).await;
    assert_eq!(paged, Err(ReviewWriteError::Gone));
    let _ = live.chat_page(None, 500).await;
    assert!(started.elapsed() < Duration::from_secs(5));
    rig.mock
        .plan_fault(Some("POST"), &route, Fault::Delay(Duration::from_secs(600)));
    let sending = {
        let live = Arc::clone(&live);
        tokio::spawn(async move { live.send_chat("during stop").await })
    };
    tokio::time::sleep(Duration::from_millis(50)).await;
    let stopped = Instant::now();
    live.stop().await;
    assert!(stopped.elapsed() < Duration::from_secs(5));
    let outcome = tokio::time::timeout(WAIT, sending).await.unwrap().unwrap();
    assert!(outcome.is_err(), "{outcome:?}");
}

#[tokio::test]
async fn the_newest_chat_page_is_read_again_later_once_the_tries_run_out() {
    let rig = Rig::start(chat_project()).await;
    assert_eq!(
        rig.mock
            .peer("bob")
            .post_chat("Before the outage", None)
            .status,
        204
    );
    for _ in 0..9 {
        rig.mock.plan_fault(
            Some("GET"),
            &messages_route(&rig),
            Fault::Reply(503, "Service Unavailable".into()),
        );
    }
    let port = Port::new(&[]);
    let tuned = SessionTuning {
        review_retry: Duration::from_millis(20),
        ..tuning()
    };
    let live = chat_live_tuned(&rig, "alice", &port, tuned).await;
    eventually("the failed reads are reported", || {
        port.seen()
            .chat
            .iter()
            .any(|change| change.trouble.is_some())
    })
    .await;
    eventually("a later read clears the trouble", || {
        port.seen()
            .chat
            .last()
            .is_some_and(|change| change.trouble.is_none())
    })
    .await;
    assert_eq!(chat_reads(&rig), 10);
    assert_eq!(
        page(&live, 10).await,
        vec![("Before the outage".to_string(), false)]
    );
    assert_eq!(chat_reads(&rig), 10);
    live.stop().await;
}

#[tokio::test]
async fn rate_limited_sends_say_so_and_are_never_retried() {
    let rig = Rig::start(chat_project()).await;
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    let route = messages_route(&rig);
    rig.mock.plan_fault(
        Some("POST"),
        &route,
        Fault::Reply(429, "Rate limit reached, please try again later".into()),
    );
    assert!(matches!(
        live.send_chat("too fast").await,
        Err(ReviewWriteError::Rest(ReviewError::Rest(
            RestError::RateLimited(_)
        )))
    ));
    let posts = rig
        .mock
        .requests(&route)
        .into_iter()
        .filter(|request| request.method == "POST")
        .count();
    assert_eq!(posts, 1);
    assert!(rig.mock.chat_messages().as_array().unwrap().is_empty());
    live.stop().await;
}

#[tokio::test]
async fn invited_people_are_listed_and_accepted_invites_drop() {
    let rig =
        Rig::start(chat_project().invited("erin@example.test", Privilege::ReadAndWrite)).await;
    let alice_port = Port::new(&[]);
    let alice = chat_live(&rig, "alice", &alice_port).await;
    let bob_port = Port::new(&[]);
    let bob = chat_live(&rig, "bob", &bob_port).await;
    let invited = |live: &OverleafSession| -> Vec<String> {
        live.people()
            .people
            .into_iter()
            .filter(|person| person.standing == Standing::Invited)
            .map(|person| person.email)
            .collect()
    };
    assert_eq!(invited(&alice), vec!["erin@example.test".to_string()]);
    assert_eq!(invited(&bob), vec!["erin@example.test".to_string()]);
    let erin = alice
        .people()
        .people
        .into_iter()
        .find(|person| person.standing == Standing::Invited)
        .unwrap();
    assert_eq!(erin.role, Some(Role::Editor));
    rig.mock.invite("frank@example.test", Privilege::ReadOnly);
    eventually("the owner reads the invites again", || {
        invited(&alice).len() == 2
    })
    .await;
    assert!(rig
        .mock
        .requests(&format!("/project/{}/invites", rig.mock.project_id()))
        .iter()
        .all(|request| request
            .headers
            .get("cookie")
            .is_some_and(|cookie| cookie.contains(&rig.mock.user("alice").session))));
    rig.mock.accept_invite("erin@example.test", "erin");
    for live in [&alice, &bob] {
        eventually("erin is a member", || {
            live.people().people.iter().any(|person| {
                person.email == "erin@example.test" && person.standing == Standing::Member
            })
        })
        .await;
    }
    eventually("the accepted invite drops", || {
        !invited(&alice).contains(&"erin@example.test".to_string())
    })
    .await;
    assert!(!invited(&bob).contains(&"erin@example.test".to_string()));
    alice.stop().await;
    bob.stop().await;
    assert!(alice
        .people()
        .people
        .iter()
        .all(|person| person.standing != Standing::Former));
}

#[tokio::test]
async fn former_member_name_is_kept_for_history() {
    let rig = Rig::start(chat_project()).await;
    let bob = rig.mock.peer("bob");
    assert_eq!(bob.post_chat("Bob was here", None).status, 204);
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    eventually("the first page is in", || chat_reads(&rig) >= 1).await;
    assert!(live.people().link_shared);
    rig.mock.set_privilege("bob", None);
    eventually("bob left the roster", || {
        live.people()
            .people
            .iter()
            .any(|person| person.id == rig.user_id("bob") && person.standing == Standing::Former)
    })
    .await;
    let former = live
        .people()
        .people
        .into_iter()
        .find(|person| person.id == rig.user_id("bob"))
        .unwrap();
    assert_eq!(
        (former.first_name.as_str(), former.last_name.as_str()),
        ("Bob", "Tester")
    );
    assert_eq!(former.role, None);
    live.stop().await;
}

#[tokio::test]
async fn authors_named_in_history_join_the_people_once_and_are_told() {
    let rig = Rig::start(chat_project()).await;
    let port = Port::new(&[]);
    let live = chat_live(&rig, "alice", &port).await;
    let told = port.seen().members_changed;
    let gone = ReviewUser {
        id: "6b04e5f6c0ffee00aa000001".into(),
        first_name: Some("Hana".into()),
        last_name: Some("Old".into()),
        email: Some("hana@oleafly.edu".into()),
    };
    let bob = ReviewUser {
        id: rig.user_id("bob"),
        first_name: Some("Bob".into()),
        last_name: Some("Tester".into()),
        email: None,
    };
    live.know_people([&gone, &bob]);
    let people = live.people().people;
    let former = people.iter().find(|person| person.id == gone.id).unwrap();
    assert_eq!(
        (
            former.standing,
            former.first_name.as_str(),
            former.email.as_str()
        ),
        (Standing::Former, "Hana", "hana@oleafly.edu")
    );
    let listed: Vec<Standing> = people
        .iter()
        .filter(|person| person.id == bob.id)
        .map(|person| person.standing)
        .collect();
    assert_eq!(listed, [Standing::Member]);
    assert_eq!(port.seen().members_changed, told + 1);
    live.know_people([&gone, &bob]);
    assert_eq!(port.seen().members_changed, told + 1);
    live.stop().await;
}

#[tokio::test]
async fn review_counts_cover_docs_nobody_opened() {
    let rig = Rig::start(chat_project()).await;
    let notes = rig.id(NOTES);
    rig.mock.set_ranges(
        &notes.0,
        json!({ "comments": [{ "id": "6b04e5f6c0ffee0010000001", "op": { "p": 0, "c": "Notes", "t": "6b04e5f6c0ffee0010000001" } }] }),
    );
    let port = Port::new(&[]);
    let mut tuned = tuning();
    tuned.trickle_every = Duration::from_millis(150);
    let live = chat_live_tuned(&rig, "alice", &port, tuned).await;
    let _tab = Tab::open(&live, MAIN);
    eventually("the open doc is joined", || {
        live.review(&rig.id(MAIN)).is_some()
    })
    .await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(!rig.has_joined("alice", &notes));
    let counts = live.review_counts();
    assert!(counts.iter().all(|(doc, _)| *doc != notes));
    eventually("the other doc is joined in the background", || {
        live.review_counts()
            .iter()
            .any(|(doc, counts)| *doc == notes && counts.open == 1)
    })
    .await;
    assert_eq!(
        live.threads().anchored.get("6b04e5f6c0ffee0010000001"),
        Some(&notes)
    );
    let joins = rig.joins_except(&[]);
    assert_eq!(joins.iter().filter(|doc| **doc == notes.0).count(), 1);
    live.stop().await;
}

struct Held {
    state: State,
    _dir: tempfile::TempDir,
    _journal: Journal,
}

fn held_state(project: Value, level: &str, me: &str) -> Held {
    let project = ProjectState::from_join(json!({
        "publicId": "P.replay",
        "permissionsLevel": level,
        "project": project,
    }))
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let journal = Journal::open(
        dir.path(),
        "http://localhost:8080",
        "64f0c0ffee0123456789abcd",
        None,
    )
    .unwrap();
    let state = State::new(
        project,
        Account {
            user_id: me.into(),
            email: format!("{me}@example.test"),
        },
        &journal,
        Port::new(&[]) as Arc<dyn LivePort>,
    );
    Held {
        state,
        _dir: dir,
        _journal: journal,
    }
}

fn bare_project(owner: Value, members: Value, invites: Value) -> Value {
    json!({
        "_id": "64f0c0ffee0123456789abcd",
        "name": "replay",
        "rootFolder": [{ "_id": "f0", "name": "rootFolder", "docs": [], "fileRefs": [], "folders": [] }],
        "owner": owner,
        "members": members,
        "invites": invites,
        "publicAccesLevel": "private",
    })
}

fn chat_events(frames: &[crate::test_support::overleaf_rt::Frame]) -> Vec<(u64, ChatEvent)> {
    frames
        .iter()
        .filter(|frame| !frame.outgoing)
        .filter_map(|frame| {
            let packet = crate::realtime::codec::decode(&frame.raw).ok()?;
            let (name, args) = packet.into_event()?;
            match ServerEvent::from_wire(&name, &args) {
                ServerEvent::Chat(event) => Some((frame.t, event)),
                _ => None,
            }
        })
        .collect()
}

fn query_number(route: &str, key: &str) -> Option<Option<i64>> {
    let query = route.split_once('?').map_or("", |(_, query)| query);
    match query
        .split('&')
        .find_map(|pair| pair.strip_prefix(&format!("{key}=")))
    {
        None => Some(None),
        Some(value) => value.parse::<i64>().ok().map(Some),
    }
}

#[test]
fn recorded_ce_chat_replays_into_the_cache_like_every_page_it_read() {
    let recording = recordings()
        .into_iter()
        .find(|recording| recording.name == "project-chat")
        .expect("the project-chat recording");
    let chat: Value = serde_json::from_str(&recording.extra("chat.json").unwrap()).unwrap();
    let steps = chat["steps"].as_array().unwrap();
    let mut compared = 0;
    for trace in &recording.traces {
        let events = chat_events(&trace.frames);
        assert!(
            events.len() >= 10,
            "{}: {} chat events",
            trace.name,
            events.len()
        );
        let mut held = held_state(
            bare_project(
                json!({ "_id": "u0", "email": "o@example.test", "privileges": "owner" }),
                json!([]),
                json!([]),
            ),
            "owner",
            &trace.user_id,
        );
        let state = &mut held.state;
        state.set_chat_support(true);
        let mut events = events.into_iter().peekable();
        let mut loaded = false;
        for step in steps {
            let route = step["request"]["route"].as_str().unwrap_or_default();
            if step["request"]["method"] != "GET" || step["status"] != 200 {
                continue;
            }
            let sent_at = step["sentAt"].as_u64().unwrap();
            while let Some((_, event)) = events.next_if(|(t, _)| *t < sent_at) {
                state.chat_event(event);
            }
            let (Some(limit), Some(before)) =
                (query_number(route, "limit"), query_number(route, "before"))
            else {
                continue;
            };
            let limit = limit.map_or(50, |limit| limit as usize);
            if limit == 0 {
                continue;
            }
            let page: Vec<crate::realtime::events::ThreadMessage> = step["body"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(crate::realtime::events::ThreadMessage::from_value)
                .collect();
            if !loaded {
                let ticket = state.begin_chat_fetch();
                state.chat_fetched(ticket, page.clone(), 50);
                loaded = true;
            }
            let ours: Vec<(String, String, bool)> = state
                .chat_served(None, 10_000)
                .into_iter()
                .rev()
                .filter(|entry| !entry.deleted)
                .filter(|entry| {
                    before.is_none_or(|before| entry.message.timestamp.unwrap_or_default() < before)
                })
                .take(limit)
                .map(|entry| {
                    (
                        entry.message.id,
                        entry.message.content,
                        entry.message.edited_at.is_some(),
                    )
                })
                .collect();
            let theirs: Vec<(String, String, bool)> = page
                .into_iter()
                .map(|message| (message.id, message.content, message.edited_at.is_some()))
                .collect();
            assert_eq!(ours, theirs, "{}: {}", trace.name, step["label"]);
            compared += 1;
        }
        for (_, event) in events {
            state.chat_event(event);
        }
        let left = state.chat_served(None, 10_000);
        assert!(
            !left.is_empty() && left.iter().all(|entry| entry.deleted),
            "{}",
            trace.name
        );
    }
    assert!(compared >= 3 * 8, "only {compared} pages compared");
}

#[test]
fn recorded_ce_link_viewer_hears_no_chat_and_is_refused() {
    let recorded = probe("chat-restricted-user");
    let steps = recorded["steps"].as_array().unwrap();
    let mut refused = 0;
    let mut heard = std::collections::BTreeMap::new();
    for step in steps {
        if step["request"]["route"]
            .as_str()
            .is_some_and(|route| route.contains("/messages"))
            && step["request"]["user"] == "erin"
        {
            assert_eq!(step["status"], 403);
            assert_eq!(step["body"], json!({ "message": "restricted" }));
            refused += 1;
        }
        if let Some(socket) = step.get("socket") {
            let frames: Vec<crate::test_support::overleaf_rt::Frame> = socket["frames"]
                .as_array()
                .unwrap()
                .iter()
                .map(|frame| crate::test_support::overleaf_rt::Frame {
                    t: frame["t"].as_u64().unwrap_or_default(),
                    outgoing: frame["dir"] == "out",
                    raw: frame["frame"].as_str().unwrap().to_string(),
                })
                .collect();
            heard.insert(
                socket["user"].as_str().unwrap().to_string(),
                chat_events(&frames).len(),
            );
        }
    }
    assert_eq!(refused, 2);
    assert_eq!(heard.get("alice"), Some(&3));
    assert_eq!(heard.get("erin"), Some(&0));
    let mut restricted = held_state(
        bare_project(json!({ "_id": "u0" }), json!([]), json!([])),
        "readOnly",
        "erin",
    );
    assert!(restricted.state.project.restricted);
    restricted.state.set_chat_support(true);
    assert!(!restricted.state.chat_support().available);
    restricted.state.chat_event(ChatEvent::Deleted {
        message: "m1".into(),
        user_id: None,
    });
    assert_eq!(
        restricted.state.chat_writable(),
        Err(ReviewWriteError::Restricted)
    );
}

#[test]
fn recorded_ce_invites_come_from_the_join_and_an_accepted_one_drops() {
    let recorded = probe("people-invites");
    let steps = recorded["steps"].as_array().unwrap();
    let owner_join = &steps[10]["join"];
    let held = held_state(
        bare_project(
            owner_join["owner"].clone(),
            owner_join["members"].clone(),
            owner_join["invites"].clone(),
        ),
        "owner",
        owner_join["owner"]["_id"].as_str().unwrap(),
    );
    let invited: Vec<(String, Role)> = held
        .state
        .people_view()
        .people
        .into_iter()
        .filter(|person| person.standing == Standing::Invited)
        .map(|person| (person.email, person.role.unwrap()))
        .collect();
    assert_eq!(
        invited,
        vec![
            ("erin@example.test".to_string(), Role::Editor),
            ("frank@example.test".to_string(), Role::Viewer),
            ("carol@example.test".to_string(), Role::Reviewer),
            ("erin@example.test".to_string(), Role::Viewer),
        ]
    );
    let member_join = &steps[25]["join"];
    let erin = held_state(
        bare_project(
            owner_join["owner"].clone(),
            member_join["members"].clone(),
            member_join["invites"].clone(),
        ),
        member_join["permissionsLevel"].as_str().unwrap(),
        "6afab5bd1222cc50aa4c1704",
    );
    let people = erin.state.people_view().people;
    assert!(people
        .iter()
        .all(|person| person.standing != Standing::Invited));
    assert!(people.iter().any(|person| {
        person.email == "erin@example.test" && person.standing == Standing::Member
    }));
    let changes: Vec<AccessEvent> = steps
        .iter()
        .filter_map(|step| step.get("socket"))
        .flat_map(|socket| socket["frames"].as_array().unwrap().iter())
        .filter_map(|frame| {
            let packet = crate::realtime::codec::decode(frame["frame"].as_str()?).ok()?;
            let (name, args) = packet.into_event()?;
            match ServerEvent::from_wire(&name, &args) {
                ServerEvent::Access(event @ AccessEvent::MembersChanged { .. }) => Some(event),
                _ => None,
            }
        })
        .collect();
    assert!(changes.contains(&AccessEvent::MembersChanged {
        members: false,
        invites: true
    }));
    assert!(changes.contains(&AccessEvent::MembersChanged {
        members: true,
        invites: true
    }));
    assert!(changes.contains(&AccessEvent::MembersChanged {
        members: true,
        invites: false
    }));
}

#[tokio::test]
async fn a_slow_member_refresh_never_brings_back_a_consumed_invite() {
    let rig = Rig::start(chat_project().invited("erin@example.test", Privilege::ReadOnly)).await;
    let port = Port::new(&[]);
    let alice = chat_live(&rig, "alice", &port).await;
    let erin = || {
        alice
            .people()
            .people
            .into_iter()
            .find(|person| person.email == "erin@example.test")
            .map(|person| person.standing)
    };
    eventually("erin is invited", || erin() == Some(Standing::Invited)).await;
    let members = format!("/project/{}/members", rig.mock.project_id());
    let invites = format!("/project/{}/invites", rig.mock.project_id());
    let read_invites = rig.mock.requests(&invites).len();
    rig.mock.plan_fault(
        Some("GET"),
        &members,
        Fault::Delay(Duration::from_millis(1500)),
    );
    rig.mock.plan_fault(
        Some("GET"),
        &invites,
        Fault::Delay(Duration::from_millis(400)),
    );
    rig.mock.accept_invite("erin@example.test", "erin");
    eventually("the invites are read again", || {
        rig.mock.requests(&invites).len() > read_invites
    })
    .await;
    eventually("erin is a member", || erin() == Some(Standing::Member)).await;
    let read_members = rig.mock.requests(&members).len();
    rig.mock.set_privilege("erin", None);
    eventually("the members are read again", || {
        rig.mock.requests(&members).len() > read_members
    })
    .await;
    eventually("erin is no longer a member", || {
        erin() != Some(Standing::Member)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_ne!(erin(), Some(Standing::Invited));
    alice.stop().await;
}
