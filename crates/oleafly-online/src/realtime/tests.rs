use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};

use super::codec::{self, Frame, FrameError};
use super::connection::{
    connect, connect_tuned, CallError, Carrier, Connection, Dropped, JoinProject, RealtimeError,
    Tuning,
};
use super::events::{AppliedUpdate, DocId, PublicId, Rejection, ServerEvent, TreeEvent};
use super::page::ProjectPage;
use crate::client::Http;
use crate::session::{self, Session, SessionHandle};
use crate::test_support::mock_overleaf::{
    MockConfig, MockOverleaf, MockProject, MockUser, Privilege, Rejection as MockRejection,
    Transport,
};
use crate::test_support::overleaf_rt::{probe_event, recordings};

const AGENT: &str = "Oleafly/test";
const WAIT: Duration = Duration::from_secs(10);
const BOTH: [Carrier; 2] = [Carrier::WebSocket, Carrier::XhrPolling];

fn project() -> MockProject {
    MockProject::new("realtime")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .outsider(MockUser::named("zed"))
        .doc("main.tex", "\\documentclass{article}\nHello")
        .doc("sections/intro.tex", "Intro")
}

fn handle_for(
    base: &str,
    user: &MockUser,
    store: Option<oleafly_secrets::SecretStore>,
) -> SessionHandle {
    SessionHandle::new(
        base,
        Session {
            cookie: user.cookie(),
            user_id: user.id.clone(),
            email: user.email.clone(),
            saved_by: None,
        },
        store,
    )
}

struct Rig {
    mock: MockOverleaf,
    http: Http,
}

impl Rig {
    async fn start() -> Rig {
        let mock = MockOverleaf::start(project()).await;
        let http = Http::new(&mock.base, AGENT).unwrap();
        Rig { mock, http }
    }

    fn session(&self, name: &str) -> SessionHandle {
        handle_for(&self.mock.base, &self.mock.user(name), None)
    }

    fn signed_out(&self) -> SessionHandle {
        let mut nobody = MockUser::named("nobody");
        nobody.session = "expired".into();
        handle_for(&self.mock.base, &nobody, None)
    }

    async fn page(&self, session: &SessionHandle) -> ProjectPage {
        ProjectPage::load(&self.http, session, &self.mock.project_id(), false)
            .await
            .unwrap()
    }

    fn bare_page(&self) -> ProjectPage {
        ProjectPage::unloaded(&self.mock.project_id()).unwrap()
    }

    fn count(&self, prefix: &str) -> usize {
        self.mock.requests(prefix).len()
    }

    fn handshake_prefix(&self) -> String {
        format!("/socket.io/1/?projectId={}", self.mock.project_id())
    }

    fn configure(&self, change: impl FnOnce(&mut MockConfig)) {
        self.mock.configure(change);
    }

    async fn connect(&self, name: &str, carriers: &[Carrier]) -> (Connection, JoinProject) {
        let session = self.session(name);
        let page = self.page(&session).await;
        connect(&self.http, &session, &page, carriers)
            .await
            .unwrap()
    }
}

async fn next(connection: &mut Connection) -> Option<ServerEvent> {
    tokio::time::timeout(WAIT, connection.next_event())
        .await
        .expect("an event or the end in time")
}

async fn eventually(mut check: impl FnMut() -> bool) {
    let started = std::time::Instant::now();
    while !check() {
        assert!(started.elapsed() < WAIT, "timed out waiting");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn rejection(result: Result<(Connection, JoinProject), RealtimeError>) -> Rejection {
    match result {
        Err(RealtimeError::Rejected(rejection)) => rejection,
        other => panic!("expected a rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn connects_over_websocket_and_reads_join_project_response() {
    let rig = Rig::start().await;
    let (connection, join) = rig.connect("alice", &BOTH).await;
    assert_eq!(connection.carrier(), Carrier::WebSocket);
    assert_eq!(connection.public_id(), &join.public_id);
    assert_eq!(join.response["permissionsLevel"], "owner");
    assert_eq!(join.response["protocolVersion"], 2);
    assert_eq!(join.project()["name"], "realtime");
    let server = rig.mock.connections();
    assert_eq!(server.len(), 1);
    assert_eq!(server[0].public_id, join.public_id.0);
    assert_eq!(server[0].transport, Transport::WebSocket);
    let handshakes = rig.mock.requests(&rig.handshake_prefix());
    assert_eq!(handshakes.len(), 1);
    assert!(
        handshakes[0].path.contains("&esh=1&ssp=1"),
        "{}",
        handshakes[0].path
    );
    assert!(handshakes[0].path.contains("&t="));
    let upgrade = &rig.mock.requests("/socket.io/1/websocket/")[0];
    let header = |name: &str| upgrade.headers.get(name).cloned().unwrap_or_default();
    assert_eq!(header("user-agent"), AGENT);
    assert_eq!(header("origin"), rig.http.origin);
    assert!(header("cookie").contains("overleaf.sid=session-alice"));
    let doc = rig.mock.doc_id("main.tex");
    let reply = connection
        .call(
            "joinDoc",
            vec![
                json!(doc),
                json!({ "encodeRanges": true, "supportsHistoryOT": true }),
            ],
        )
        .await
        .unwrap();
    assert_eq!(reply[0], Value::Null);
    assert_eq!(reply[2], json!(0));
    connection.emit(
        "clientTracking.updatePosition",
        vec![json!({ "row": 1, "column": 2, "doc_id": doc })],
    );
    eventually(|| {
        !rig.mock
            .received("clientTracking.updatePosition")
            .is_empty()
    })
    .await;
    connection.close().await;
    eventually(|| rig.mock.connections().is_empty()).await;
}

#[tokio::test]
async fn polling_carries_calls_heartbeats_and_room_events() {
    let rig = Rig::start().await;
    rig.configure(|config| config.poll_hold = Duration::from_millis(200));
    let (mut connection, join) = rig.connect("alice", &[Carrier::XhrPolling]).await;
    assert_eq!(connection.carrier(), Carrier::XhrPolling);
    assert!(!rig.mock.requests(&rig.handshake_prefix())[0]
        .path
        .contains("esh=1"));
    assert_eq!(rig.mock.connections()[0].transport, Transport::Polling);
    let doc = rig.mock.doc_id("main.tex");
    let reply = connection
        .call("joinDoc", vec![json!(doc), json!({ "encodeRanges": true })])
        .await
        .unwrap();
    assert_eq!(reply[0], Value::Null);
    let mut bob = rig.mock.peer("bob");
    bob.join(&doc);
    bob.type_at(&doc, 0, "B");
    let applied = loop {
        if let Some(ServerEvent::Applied(update)) = next(&mut connection).await {
            break update;
        }
    };
    assert_eq!(applied.doc, DocId(doc.clone()));
    assert_eq!(applied.source, Some(PublicId(bob.public_id.clone())));
    assert!(applied.op.is_some());
    rig.mock.server_ping();
    rig.mock
        .emit_to_room("projectNameUpdated", &[json!("Renamed")]);
    loop {
        if let Some(ServerEvent::Project(_)) = next(&mut connection).await {
            break;
        }
    }
    assert!(rig.mock.received("clientPong").is_empty());
    assert_eq!(connection.public_id(), &join.public_id);
    connection.close().await;
}

#[tokio::test]
async fn heartbeats_are_echoed_on_both_carriers() {
    for carrier in BOTH {
        let rig = Rig::start().await;
        rig.configure(|config| {
            config.heartbeat = Some(Duration::from_millis(50));
            config.poll_hold = Duration::from_millis(100);
        });
        let (connection, join) = rig.connect("alice", &[carrier]).await;
        let public = join.public_id.0.clone();
        eventually(|| {
            rig.mock
                .connections()
                .iter()
                .any(|client| client.public_id == public)
        })
        .await;
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(connection.dropped().is_none(), "{carrier:?}");
        assert_eq!(connection.carrier(), carrier);
        connection.close().await;
    }
}

#[tokio::test]
async fn calls_get_their_own_ack_ids_starting_at_one() {
    let rig = Rig::start().await;
    let (connection, _) = rig.connect("alice", &BOTH).await;
    let main = rig.mock.doc_id("main.tex");
    let intro = rig.mock.doc_id("sections/intro.tex");
    let (first, second, third) = tokio::join!(
        connection.call("joinDoc", vec![json!(main), json!({})]),
        connection.call("joinDoc", vec![json!(intro), json!({})]),
        connection.call("clientTracking.getConnectedUsers", vec![]),
    );
    let lines = |reply: Vec<Value>| reply[1].clone();
    assert_eq!(
        lines(first.unwrap()),
        json!(["\\documentclass{article}", "Hello"])
    );
    assert_eq!(lines(second.unwrap()), json!(["Intro"]));
    assert!(third.unwrap()[1].is_array());
    let raw: Vec<String> = rig
        .mock
        .received("joinDoc")
        .iter()
        .map(|received| received.args[0].as_str().unwrap().to_string())
        .collect();
    assert_eq!(raw.len(), 2);
    connection.close().await;
}

#[tokio::test]
async fn uses_ol_ws_url_then_falls_back() {
    let rig = Rig::start().await;
    let ws_url = rig.mock.ws_url();
    rig.configure(|config| config.ws_url = Some(ws_url.clone()));
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    assert_eq!(page.ws_url(), Some(ws_url));
    let (connection, _) = connect(&rig.http, &session, &page, &BOTH).await.unwrap();
    assert_eq!(connection.carrier(), Carrier::WebSocket);
    let routed = format!("/rt{}", rig.handshake_prefix());
    assert_eq!(rig.count(&routed), 1);
    assert_eq!(rig.count(&rig.handshake_prefix()), 0);
    assert_eq!(rig.count("/rt/socket.io/1/websocket/"), 1);
    assert_eq!(page.loads(), 1);
    connection.close().await;

    rig.configure(|config| {
        config.ws_url_handshake_reply = Some((503, "Service Unavailable".into()));
    });
    let page = rig.page(&session).await;
    let (connection, _) = connect(&rig.http, &session, &page, &BOTH).await.unwrap();
    assert!(page.is_fallback());
    assert_eq!(page.ws_url(), None);
    assert_eq!(page.loads(), 2);
    let fallback = format!("/project/{}?ws=fallback", rig.mock.project_id());
    assert_eq!(rig.count(&fallback), 1);
    assert_eq!(rig.count(&rig.handshake_prefix()), 1);
    assert_eq!(rig.count(&routed), 2);
    assert_eq!(connection.carrier(), Carrier::WebSocket);
    connection.close().await;
}

#[tokio::test]
async fn a_v2_handshake_triggers_the_page_fallback() {
    let rig = Rig::start().await;
    rig.configure(|config| {
        config.ws_url = Some(String::new());
        config.ws_url_handshake_reply = Some((
            200,
            "97:0{\"sid\":\"v2sid\",\"upgrades\":[\"websocket\"],\"pingInterval\":25000,\"pingTimeout\":20000}2:40".into(),
        ));
    });
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    assert_eq!(page.ws_url(), None);
    let ws_url = rig.mock.ws_url();
    rig.configure(|config| config.ws_url = Some(ws_url));
    let page = rig.page(&session).await;
    assert!(page.ws_url().is_some());
    let (connection, join) = connect(&rig.http, &session, &page, &BOTH).await.unwrap();
    assert!(page.is_fallback());
    assert_eq!(page.ws_url(), None);
    let fallback = format!("/project/{}?ws=fallback", rig.mock.project_id());
    assert_eq!(rig.count(&fallback), 1);
    assert_eq!(rig.count(&rig.handshake_prefix()), 1);
    assert_eq!(rig.mock.connections()[0].public_id, join.public_id.0);
    connection.close().await;
    let (again, _) = connect(&rig.http, &session, &page, &BOTH).await.unwrap();
    assert_eq!(rig.count(&fallback), 1);
    assert_eq!(rig.count(&format!("/rt{}", rig.handshake_prefix())), 1);
    again.close().await;
}

#[tokio::test]
async fn three_websocket_failures_fall_back_to_polling() {
    let rig = Rig::start().await;
    rig.configure(|config| config.upgrade_status = Some(403));
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    let (connection, _) = connect(&rig.http, &session, &page, &BOTH).await.unwrap();
    assert_eq!(connection.carrier(), Carrier::XhrPolling);
    assert_eq!(rig.count("/socket.io/1/websocket/"), 3);
    let handshakes = rig.mock.requests(&rig.handshake_prefix());
    assert_eq!(handshakes.len(), 4);
    assert_eq!(
        handshakes
            .iter()
            .filter(|request| request.path.contains("esh=1"))
            .count(),
        3
    );
    connection.close().await;
    let (again, _) = connect(&rig.http, &session, &page, &BOTH).await.unwrap();
    assert_eq!(again.carrier(), Carrier::XhrPolling);
    assert_eq!(rig.count("/socket.io/1/websocket/"), 3);
    again.close().await;
    let fresh = rig.page(&session).await;
    let only_websocket = connect(&rig.http, &session, &fresh, &[Carrier::WebSocket]).await;
    assert!(
        matches!(only_websocket, Err(RealtimeError::Transport(_))),
        "{only_websocket:?}"
    );
    assert_eq!(rig.count("/socket.io/1/websocket/"), 6);
}

#[tokio::test]
async fn a_server_without_websockets_goes_straight_to_polling() {
    let rig = Rig::start().await;
    rig.configure(|config| config.websocket = false);
    let (connection, _) = rig.connect("alice", &BOTH).await;
    assert_eq!(connection.carrier(), Carrier::XhrPolling);
    assert_eq!(rig.count("/socket.io/1/websocket/"), 0);
    assert_eq!(rig.count(&rig.handshake_prefix()), 2);
    connection.close().await;
}

#[tokio::test]
async fn answers_server_ping_with_client_pong() {
    let rig = Rig::start().await;
    let (connection, _) = rig.connect("alice", &BOTH).await;
    rig.mock.server_ping();
    rig.mock.server_ping();
    eventually(|| rig.mock.received("clientPong").len() == 2).await;
    let pongs = rig.mock.received("clientPong");
    let sid = connection.session_id().to_string();
    for (counter, pong) in pongs.iter().enumerate() {
        assert_eq!(pong.args.len(), 6);
        assert_eq!(pong.args[0], json!(counter));
        assert!(pong.args[1].is_u64());
        assert_eq!(pong.args[2], json!("websocket"));
        assert_eq!(pong.args[3], json!(sid));
        assert_eq!(pong.args[4], json!("websocket"));
        assert_eq!(pong.args[5], json!(sid));
    }
    connection.close().await;
}

#[tokio::test]
async fn treats_heartbeat_silence_as_a_disconnect() {
    let rig = Rig::start().await;
    let (mut connection, _) = rig.connect("alice", &BOTH).await;
    rig.mock.stall();
    tokio::time::pause();
    let started = tokio::time::Instant::now();
    assert_eq!(connection.next_event().await, None);
    let silent = started.elapsed();
    tokio::time::resume();
    assert!(
        matches!(connection.dropped(), Some(Dropped::Silent(gap)) if gap > Duration::from_secs(60)),
        "{:?}",
        connection.dropped()
    );
    assert!(silent >= Duration::from_secs(60), "{silent:?}");
    assert!(silent < Duration::from_secs(70), "{silent:?}");
    assert_eq!(
        connection.call("joinDoc", vec![json!("x")]).await,
        Err(CallError::Closed)
    );
}

static JUMP: AtomicU64 = AtomicU64::new(0);

fn jumped_clock() -> SystemTime {
    SystemTime::now() + Duration::from_secs(JUMP.load(Ordering::SeqCst))
}

#[tokio::test]
async fn clock_jump_reads_as_sleep() {
    let rig = Rig::start().await;
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    let tuning = Tuning {
        tick: Duration::from_millis(20),
        wall_clock: jumped_clock,
        ..Tuning::default()
    };
    let (mut connection, _) = connect_tuned(&rig.http, &session, &page, &BOTH, &tuning)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(connection.dropped().is_none());
    JUMP.store(30, Ordering::SeqCst);
    assert_eq!(next(&mut connection).await, None);
    assert!(
        matches!(connection.dropped(), Some(Dropped::Slept(gap)) if gap >= Duration::from_secs(29)),
        "{:?}",
        connection.dropped()
    );
}

#[tokio::test]
async fn keeps_the_balancer_cookie_from_the_handshake() {
    for carrier in BOTH {
        let rig = Rig::start().await;
        rig.configure(|config| {
            config.balancer_cookie = Some("GCLB=rt-7".into());
            config.poll_hold = Duration::from_millis(100);
        });
        let session = rig.session("alice");
        let page = rig.page(&session).await;
        let (connection, _) = connect(&rig.http, &session, &page, &[carrier])
            .await
            .unwrap();
        assert!(session.cookie().contains("GCLB=rt-7"), "{carrier:?}");
        assert!(session.cookie().contains("overleaf.sid=session-alice"));
        if carrier == Carrier::WebSocket {
            let upgrade = &rig.mock.requests("/socket.io/1/websocket/")[0];
            assert!(upgrade.headers["cookie"].contains("GCLB=rt-7"));
        }
        let doc = rig.mock.doc_id("main.tex");
        let reply = connection
            .call("joinDoc", vec![json!(doc), json!({})])
            .await;
        assert_eq!(reply.unwrap()[0], Value::Null, "{carrier:?}");
        connection.close().await;
    }
    let rig = Rig::start().await;
    rig.configure(|config| config.balancer_cookie = Some("GCLB=rt-7".into()));
    let handshake = rig
        .http
        .get(
            &format!("{}&t=1", rig.handshake_prefix()),
            &rig.mock.user("alice").cookie(),
        )
        .send()
        .await
        .unwrap();
    let sid = handshake.text().await.unwrap();
    let sid = sid.split(':').next().unwrap();
    let unpinned = rig
        .http
        .get(
            &format!(
                "/socket.io/1/xhr-polling/{sid}?projectId={}",
                rig.mock.project_id()
            ),
            &rig.mock.user("alice").cookie(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(unpinned.text().await.unwrap(), "7:::1+0");
}

#[tokio::test]
async fn writes_back_a_rotated_session_cookie() {
    let data = tempfile::tempdir().unwrap();
    let store = oleafly_secrets::SecretStore::at(data.path());
    let rig = Rig::start().await;
    rig.configure(|config| config.rotate_sessions = true);
    let alice = rig.mock.user("alice");
    let saved = Session {
        cookie: alice.cookie(),
        user_id: alice.id.clone(),
        email: alice.email.clone(),
        saved_by: Some("test".into()),
    };
    session::save(&store, &rig.mock.base, &saved).unwrap();
    let handle = handle_for(&rig.mock.base, &alice, Some(store.clone()));
    let page = rig.page(&handle).await;
    let (connection, _) = connect(&rig.http, &handle, &page, &BOTH).await.unwrap();
    let sid = |cookie: &str| {
        session::parse_cookie_header(cookie)
            .into_iter()
            .find(|(name, _)| name == "overleaf.sid")
            .map(|(_, value)| value)
    };
    let rotated = handle.cookie();
    assert_ne!(sid(&rotated), Some(alice.session.clone()));
    assert_eq!(sid(&rotated), Some(rig.mock.user("alice").session));
    let stored = || session::load(&store, &rig.mock.base).unwrap().unwrap();
    eventually(|| stored().cookie == rotated).await;
    assert_eq!(stored().user_id, alice.id);
    connection.close().await;
    let (again, join) = connect(&rig.http, &handle, &page, &BOTH).await.unwrap();
    assert_eq!(join.response["permissionsLevel"], "owner");
    assert_ne!(sid(&handle.cookie()), sid(&rotated));
    eventually(|| stored().cookie == handle.cookie()).await;
    again.close().await;
}

#[tokio::test]
async fn invalid_session_with_a_working_dashboard_is_not_signed_out() {
    let rig = Rig::start().await;
    rig.configure(|config| config.reject_connections = Some(MockRejection::InvalidSession));
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    let result = connect(&rig.http, &session, &page, &BOTH).await;
    assert_eq!(rejection(result), Rejection::NotAuthorized);
    assert_eq!(
        rig.mock
            .requests("/project")
            .iter()
            .filter(|request| request.path == "/project")
            .count(),
        1
    );
    rig.configure(|config| config.reject_connections = None);
    let gone = rig.signed_out();
    let result = connect(&rig.http, &gone, &rig.bare_page(), &BOTH).await;
    assert_eq!(rejection(result), Rejection::SignedOut);
}

#[tokio::test]
async fn rejections_lost_over_polling_are_read_from_the_dashboard() {
    let rig = Rig::start().await;
    rig.configure(|config| config.poll_hold = Duration::from_millis(100));
    let gone = rig.signed_out();
    let result = connect(&rig.http, &gone, &rig.bare_page(), &[Carrier::XhrPolling]).await;
    assert_eq!(rejection(result), Rejection::SignedOut);
    rig.configure(|config| config.reject_connections = Some(MockRejection::Retry));
    let session = rig.session("alice");
    let result = connect(
        &rig.http,
        &session,
        &rig.bare_page(),
        &[Carrier::XhrPolling],
    )
    .await;
    assert_eq!(rejection(result), Rejection::Retry);
}

#[tokio::test]
async fn not_authorized_rechecks_dashboard() {
    let rig = Rig::start().await;
    let dashboards = |rig: &Rig| {
        rig.mock
            .requests("/project")
            .iter()
            .filter(|request| request.path == "/project")
            .count()
    };
    let outsider = rig.session("zed");
    let result = connect(&rig.http, &outsider, &rig.bare_page(), &BOTH).await;
    assert_eq!(rejection(result), Rejection::NotAuthorized);
    assert_eq!(dashboards(&rig), 1);
    rig.configure(|config| config.reject_connections = Some(MockRejection::NotAuthorized));
    let result = connect(&rig.http, &rig.signed_out(), &rig.bare_page(), &BOTH).await;
    assert_eq!(rejection(result), Rejection::SignedOut);
    assert_eq!(dashboards(&rig), 2);
}

#[tokio::test]
async fn project_not_found_and_other_rejections_are_classified_without_the_dashboard() {
    let rig = Rig::start().await;
    let session = rig.session("alice");
    for (planned, expected) in [
        (MockRejection::ProjectNotFound, Rejection::ProjectGone),
        (MockRejection::Retry, Rejection::Retry),
        (MockRejection::Error, Rejection::Other("error".into())),
        (
            MockRejection::BadProjectId,
            Rejection::Other("missing/bad ?projectId=... query flag on handshake".into()),
        ),
    ] {
        rig.configure(|config| config.reject_connections = Some(planned));
        let result = connect(&rig.http, &session, &rig.bare_page(), &[Carrier::WebSocket]).await;
        assert_eq!(rejection(result), expected);
    }
    assert!(rig
        .mock
        .requests("/project")
        .iter()
        .all(|request| request.path != "/project"));
}

#[tokio::test]
async fn recorded_ce_rejections_are_classified() {
    let rig = Rig::start().await;
    let signed_in = rig.session("alice");
    let signed_out = rig.signed_out();
    for (probe, when_signed_in, when_signed_out) in [
        (
            "connection-rejected-no-session",
            Rejection::NotAuthorized,
            Rejection::SignedOut,
        ),
        (
            "connection-rejected-not-a-member",
            Rejection::NotAuthorized,
            Rejection::SignedOut,
        ),
        (
            "connection-rejected-project-not-found",
            Rejection::ProjectGone,
            Rejection::ProjectGone,
        ),
        (
            "connection-rejected-rate-limit",
            Rejection::RateLimited,
            Rejection::RateLimited,
        ),
    ] {
        let payload = probe_event(probe, "websocket", "connectionRejected")
            .unwrap_or_else(|| panic!("{probe} has a connectionRejected"))
            .remove(0);
        assert_eq!(
            super::connection::classify(&rig.http, &signed_in, &payload).await,
            when_signed_in,
            "{probe}"
        );
        assert_eq!(
            super::connection::classify(&rig.http, &signed_out, &payload).await,
            when_signed_out,
            "{probe}"
        );
    }
    let bad_id = probe_event(
        "connection-rejected-bad-project-id",
        "websocket",
        "connectionRejected",
    )
    .unwrap()
    .remove(0);
    assert!(matches!(
        super::connection::classify(&rig.http, &signed_in, &bad_id).await,
        Rejection::Other(message) if message.contains("projectId")
    ));
}

#[tokio::test]
async fn rate_limited_waits_fifteen_seconds() {
    let rig = Rig::start().await;
    rig.configure(|config| config.rate_limits.joins_per_minute = 0);
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    let error = connect(&rig.http, &session, &page, &BOTH)
        .await
        .unwrap_err();
    assert!(
        matches!(error, RealtimeError::Rejected(Rejection::RateLimited)),
        "{error:?}"
    );
    for attempt in 0..40 {
        assert!(error.retry_after(attempt).unwrap() >= Duration::from_secs(15));
    }
    assert!(
        RealtimeError::Rejected(Rejection::Retry)
            .retry_after(0)
            .unwrap()
            < Duration::from_secs(1)
    );
}

#[tokio::test]
async fn project_page_loads_once_per_start() {
    let rig = Rig::start().await;
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    assert_eq!(
        page.csrf().as_deref(),
        Some(crate::test_support::mock_overleaf::MOCK_CSRF)
    );
    assert_eq!(page.user_id(), Some(rig.mock.user("alice").id));
    assert_eq!(page.max_doc_length(), Some(2 * 1024 * 1024));
    assert_eq!(
        page.max_reconnect_gracefully(),
        Some(Duration::from_secs(30))
    );
    for _ in 0..3 {
        let (connection, _) = connect(&rig.http, &session, &page, &BOTH).await.unwrap();
        connection.close().await;
    }
    let editor = format!("/project/{}", rig.mock.project_id());
    assert_eq!(
        rig.mock
            .requests(&editor)
            .iter()
            .filter(|request| request.path == editor)
            .count(),
        1
    );
    assert_eq!(page.loads(), 1);
    assert_eq!(rig.count(&rig.handshake_prefix()), 3);
    let outsider = rig.session("zed");
    assert!(
        ProjectPage::load(&rig.http, &outsider, &rig.mock.project_id(), false)
            .await
            .is_err()
    );
    assert!(
        ProjectPage::load(&rig.http, &rig.signed_out(), &rig.mock.project_id(), false)
            .await
            .is_err()
    );
    assert!(ProjectPage::unloaded("../x").is_err());
}

#[tokio::test]
async fn a_frame_that_wont_parse_drops_the_connection_and_keeps_docs() {
    for carrier in BOTH {
        let rig = Rig::start().await;
        rig.configure(|config| config.poll_hold = Duration::from_millis(100));
        let (mut connection, join) = rig.connect("alice", &[carrier]).await;
        let doc = rig.mock.doc_id("main.tex");
        connection
            .call("joinDoc", vec![json!(doc), json!({})])
            .await
            .unwrap();
        let before = rig.mock.doc_text(&doc);
        rig.mock.send_raw(
            &join.public_id.0,
            "5:::{\"name\":\"otUpdateApplied\",\"args\":[",
        );
        let mut seen = Vec::new();
        while let Some(event) = next(&mut connection).await {
            seen.push(event);
        }
        assert!(
            matches!(connection.dropped(), Some(Dropped::Malformed(_))),
            "{carrier:?} {:?}",
            connection.dropped()
        );
        assert!(
            !seen.iter().any(|event| matches!(
                event,
                ServerEvent::UpdateError { .. } | ServerEvent::Applied(_)
            )),
            "{seen:?}"
        );
        assert_eq!(rig.mock.doc_text(&doc), before);
        assert_eq!(
            connection.call("joinDoc", vec![json!(doc)]).await,
            Err(CallError::Closed)
        );
    }
}

#[tokio::test]
async fn unknown_room_events_are_ignored() {
    let rig = Rig::start().await;
    let (mut connection, _) = rig.connect("alice", &BOTH).await;
    rig.mock
        .emit_to_room("a-brand-new-event", &[json!({ "x": 1 })]);
    rig.mock
        .emit_to_room("new-chat-message", &[json!({ "content": "hi" })]);
    rig.mock.send_raw(&connection.public_id().0.clone(), "9::");
    rig.mock
        .emit_to_room("reciveEntityRename", &[json!("d1"), json!("b.tex")]);
    assert_eq!(
        next(&mut connection).await,
        Some(ServerEvent::Unknown {
            name: "a-brand-new-event".into()
        })
    );
    assert_eq!(
        next(&mut connection).await,
        Some(ServerEvent::Unknown {
            name: "new-chat-message".into()
        })
    );
    assert!(matches!(
        next(&mut connection).await,
        Some(ServerEvent::Tree(TreeEvent::Renamed { .. }))
    ));
    assert!(connection.dropped().is_none());
    let doc = rig.mock.doc_id("main.tex");
    assert!(connection.call("joinDoc", vec![json!(doc)]).await.is_ok());
    connection.close().await;
}

#[tokio::test]
async fn server_lifecycle_events_reach_the_caller_and_a_server_close_ends_the_connection() {
    let rig = Rig::start().await;
    let (mut connection, join) = rig.connect("alice", &BOTH).await;
    rig.mock.reconnect_gracefully();
    assert_eq!(
        next(&mut connection).await,
        Some(ServerEvent::ReconnectGracefully)
    );
    rig.mock.force_disconnect("Maintenance", 2);
    assert_eq!(
        next(&mut connection).await,
        Some(ServerEvent::ForceDisconnect {
            message: "Maintenance".into(),
            delay: Duration::from_secs(2)
        })
    );
    assert!(connection.dropped().is_none());
    let doc = rig.mock.doc_id("main.tex");
    let mut pending = Box::pin(connection.call("joinDoc", vec![json!("not-a-doc")]));
    let _ = tokio::time::timeout(Duration::from_millis(50), &mut pending).await;
    drop(pending);
    rig.mock.disconnect(&join.public_id.0);
    while next(&mut connection).await.is_some() {}
    assert_eq!(connection.dropped(), Some(Dropped::ServerClosed));
    assert_eq!(
        connection.call("joinDoc", vec![json!(doc)]).await,
        Err(CallError::Closed)
    );
}

#[tokio::test]
async fn a_dropped_socket_fails_the_calls_waiting_on_it() {
    let rig = Rig::start().await;
    rig.configure(|config| config.poll_hold = Duration::from_millis(100));
    for carrier in BOTH {
        let (connection, join) = rig.connect("alice", &[carrier]).await;
        rig.mock.stall();
        let waiting = connection.call("clientTracking.getConnectedUsers", vec![]);
        let cut = async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            rig.mock.drop_client(&join.public_id.0);
            rig.mock.resume();
        };
        let (answer, ()) = tokio::join!(waiting, cut);
        assert_eq!(answer, Err(CallError::Closed), "{carrier:?}");
        assert!(
            matches!(
                connection.dropped(),
                Some(Dropped::Transport(_) | Dropped::ServerError(_))
            ),
            "{carrier:?} {:?}",
            connection.dropped()
        );
    }
}

#[tokio::test]
async fn closing_says_goodbye_and_peers_see_it() {
    let rig = Rig::start().await;
    let mut bob = rig.mock.peer("bob");
    let (connection, join) = rig.connect("alice", &BOTH).await;
    connection.close().await;
    eventually(|| {
        rig.mock
            .connections()
            .iter()
            .all(|client| client.public_id != join.public_id.0)
    })
    .await;
    let left = bob.events("clientTracking.clientDisconnected");
    assert_eq!(left, vec![vec![json!(join.public_id.0)]]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn connects_through_an_http_proxy() {
    let rig = Rig::start().await;
    let upstream: std::net::SocketAddr =
        rig.mock.base.trim_start_matches("http://").parse().unwrap();
    let (proxy, asked) = oleafly_net::testing::connect_proxy(
        "HTTP/1.1 200 Connection established\r\n\r\n",
        Some(upstream),
    )
    .await;
    let session = rig.session("alice");
    let page = rig.page(&session).await;
    let tuning = Tuning {
        proxy: Some(format!("http://{proxy}")),
        ..Tuning::default()
    };
    let (connection, join) =
        connect_tuned(&rig.http, &session, &page, &[Carrier::WebSocket], &tuning)
            .await
            .unwrap();
    assert_eq!(connection.carrier(), Carrier::WebSocket);
    assert_eq!(join.response["permissionsLevel"], "owner");
    let asked = asked.lock().unwrap().clone();
    assert_eq!(asked.len(), 1);
    assert!(
        asked[0].starts_with(&format!("CONNECT {upstream} HTTP/1.1\r\n")),
        "{asked:?}"
    );
    let doc = rig.mock.doc_id("main.tex");
    assert!(connection.call("joinDoc", vec![json!(doc)]).await.is_ok());
    connection.close().await;
    let (refusing, _) =
        oleafly_net::testing::connect_proxy("HTTP/1.1 403 Forbidden\r\n\r\n", None).await;
    let tuning = Tuning {
        proxy: Some(format!("http://{refusing}")),
        ..Tuning::default()
    };
    let fresh = rig.page(&session).await;
    let (connection, _) = connect_tuned(&rig.http, &session, &fresh, &BOTH, &tuning)
        .await
        .unwrap();
    assert_eq!(connection.carrier(), Carrier::XhrPolling);
    connection.close().await;
}

#[tokio::test]
async fn import_reads_the_project_over_polling_and_says_goodbye() {
    let rig = Rig::start().await;
    rig.configure(|config| config.poll_hold = Duration::from_millis(100));
    let project = super::project::fetch_project(
        &rig.http,
        &rig.mock.user("alice").cookie(),
        &rig.mock.project_id(),
    )
    .await
    .unwrap();
    let settings = super::project::settings_from_project(&project);
    assert_eq!(settings.main_doc.as_deref(), Some("main.tex"));
    assert_eq!(settings.compiler.as_deref(), Some("pdflatex"));
    assert!(rig.mock.requests("/socket.io/1/websocket/").is_empty());
    eventually(|| rig.mock.connections().is_empty()).await;
    let editor = format!("/project/{}", rig.mock.project_id());
    assert!(rig
        .mock
        .requests(&editor)
        .iter()
        .all(|request| !request.path.starts_with(&editor)));
}

#[test]
fn every_recorded_ce_frame_decodes() {
    let mut frames = 0;
    for recording in recordings() {
        for trace in recording.traces.iter() {
            for frame in &trace.frames {
                for raw in codec::decode_payload(&frame.raw) {
                    frames += 1;
                    let decoded = codec::decode(&raw);
                    assert!(
                        !matches!(decoded, Err(FrameError::Malformed(_))),
                        "{}: {raw}",
                        recording.name
                    );
                    if let Ok(decoded) = decoded {
                        if !matches!(decoded, Frame::Error(_)) {
                            assert_eq!(codec::decode(&codec::encode(&decoded)), Ok(decoded));
                        }
                    }
                }
            }
        }
    }
    assert!(frames > 500, "{frames} frames");
}

#[test]
fn recorded_ce_room_events_are_typed() {
    let mut seen = std::collections::BTreeMap::new();
    for recording in recordings() {
        for trace in recording.traces.iter() {
            for (outgoing, packet) in trace.packets() {
                let Some((name, args)) = packet.into_event() else {
                    continue;
                };
                if outgoing
                    || matches!(
                        name.as_str(),
                        "joinProjectResponse" | "connectionRejected" | "serverPing"
                    )
                {
                    continue;
                }
                let event = ServerEvent::from_wire(&name, &args);
                assert!(
                    !matches!(event, ServerEvent::Unknown { .. }),
                    "{}: {name} {args:?}",
                    recording.name
                );
                if let ServerEvent::Applied(update) = &event {
                    assert_eq!(
                        AppliedUpdate::from_value(&args[0], None).as_ref(),
                        Some(update)
                    );
                }
                *seen.entry(name).or_insert(0) += 1;
            }
        }
    }
    for name in [
        "otUpdateApplied",
        "otUpdateError",
        "clientTracking.clientUpdated",
        "clientTracking.clientDisconnected",
        "removeEntity",
        "reciveEntityRename",
    ] {
        assert!(seen.contains_key(name), "{name} in {seen:?}");
    }
}
