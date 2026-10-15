mod people;
mod polling;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use oleafly_collab_protocol::frames::{ClientFrame, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectRole;
use people::{
    beside, connect, grant, large_change, longest_stall, next_frame, seeded, send_update,
    share_project, stage, subscribe, Person, Socket, Stage, LONGEST_STALL,
};
use polling::opened;
use reqwest::StatusCode;
use tokio::sync::{Mutex, MutexGuard};

// Each test runs the server on the test's only thread, so a ping that waits
// shows the server's thread was busy with the large change rather than
// beside it. They time that thread, so they live in a binary of their own
// and run one at a time, with no other test using the CPU.
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

async fn alone() -> MutexGuard<'static, ()> {
    ONE_AT_A_TIME.lock().await
}

async fn shared_with_alice(stage: &Stage) -> SharedProjectId {
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    assert_eq!(
        grant(
            &stage.server,
            &stage.bob,
            project,
            &stage.alice,
            ProjectRole::Editor
        )
        .await
        .status(),
        StatusCode::OK
    );
    project
}

async fn granted(stage: &Stage, project: SharedProjectId, name: &str, role: ProjectRole) -> Person {
    let person = seeded(&stage.server, name).await;
    assert_eq!(
        grant(&stage.server, &stage.bob, project, &person, role)
            .await
            .status(),
        StatusCode::OK
    );
    person
}

async fn next_change(socket: &mut Socket) -> Option<ServerFrame> {
    loop {
        match next_frame(socket).await {
            Some(ServerFrame::Presence { .. } | ServerFrame::PresenceLeft { .. }) => {}
            other => return other,
        }
    }
}

// The longest a ping waits on this machine just now, with nothing large
// going on. A large change may add at most LONGEST_STALL to it, so a slow
// or busy machine doesn't fail these tests, while a large change handled
// on the server's thread still does.
async fn quiet_stall(socket: &mut Socket) -> Duration {
    let done = AtomicBool::new(false);
    let stop = async {
        tokio::time::sleep(Duration::from_millis(1_500)).await;
        done.store(true, Ordering::SeqCst);
    };
    tokio::join!(longest_stall(socket, &done), stop).0
}

#[tokio::test(flavor = "current_thread")]
async fn a_large_change_does_not_hold_up_other_connections() {
    let _alone = alone().await;
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let carol = granted(&stage, project, "Carol", ProjectRole::Editor).await;
    let dave = granted(&stage, project, "Dave", ProjectRole::Viewer).await;
    let large = large_change(&carol, project);
    let mut alice = connect(&stage.server, &stage.alice).await;
    let quiet = quiet_stall(&mut alice).await;
    let url = stage.server.url();
    let (work, done) = beside(async move {
        let mut reader = people::connect_to(&url, &dave).await;
        subscribe(&mut reader, project, 0).await;
        let mut sender = people::connect_to(&url, &carol).await;
        subscribe(&mut sender, project, 0).await;
        send_update(&mut sender, &large).await;
        (
            next_change(&mut sender).await,
            next_change(&mut reader).await,
        )
    });
    let stall = longest_stall(&mut alice, &done).await;
    let (answer, arrived) = work.await.expect("the clients ran");
    assert!(
        matches!(answer, Some(ServerFrame::Ack { seq: 1, .. })),
        "{answer:?}"
    );
    assert!(matches!(arrived, Some(ServerFrame::Update { seq: 1, .. })));
    assert!(
        stall < LONGEST_STALL + quiet,
        "the server's thread was held for {stall:?} while a large change was stored and sent on, {quiet:?} with none"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn catching_up_on_a_large_change_does_not_hold_up_other_connections() {
    let _alone = alone().await;
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let carol = granted(&stage, project, "Carol", ProjectRole::Editor).await;
    let dave = granted(&stage, project, "Dave", ProjectRole::Viewer).await;
    let mut sender = connect(&stage.server, &carol).await;
    subscribe(&mut sender, project, 0).await;
    send_update(&mut sender, &large_change(&carol, project)).await;
    let answer = next_change(&mut sender).await;
    assert!(
        matches!(answer, Some(ServerFrame::Ack { seq: 1, .. })),
        "{answer:?}"
    );
    let mut alice = connect(&stage.server, &stage.alice).await;
    let quiet = quiet_stall(&mut alice).await;
    let url = stage.server.url();
    let (work, done) = beside(async move {
        let mut reader = people::connect_to(&url, &dave).await;
        subscribe(&mut reader, project, 0).await;
        next_change(&mut reader).await
    });
    let stall = longest_stall(&mut alice, &done).await;
    let arrived = work.await.expect("the reader ran");
    assert!(matches!(arrived, Some(ServerFrame::Update { seq: 1, .. })));
    assert!(
        stall < LONGEST_STALL + quiet,
        "the server's thread was held for {stall:?} while a large change was read from the log, {quiet:?} with none"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn a_large_change_over_long_poll_does_not_hold_up_other_connections() {
    let _alone = alone().await;
    let stage = stage().await;
    stage
        .server
        .state()
        .polls
        .set_timing(Duration::from_millis(300), Duration::from_secs(30));
    let project = shared_with_alice(&stage).await;
    let large = large_change(&stage.alice, project);
    let alice = opened(&stage.server, &stage.alice, project).await;
    let mut bob = opened(&stage.server, &stage.bob, project).await;
    let carol = seeded(&stage.server, "Carol").await;
    let mut pinger = connect(&stage.server, &carol).await;
    let quiet = quiet_stall(&mut pinger).await;
    let (work, done) = beside(async move {
        let update = ClientFrame::Update {
            project_id: project,
            envelope: large,
        };
        tokio::join!(alice.post(vec![update]), bob.collect(1))
    });
    let stall = longest_stall(&mut pinger, &done).await;
    let (answer, arrived) = work.await.expect("the clients ran");
    assert!(
        matches!(answer.as_slice(), [ServerFrame::Ack { seq: 1, .. }]),
        "{answer:?}"
    );
    assert!(matches!(
        arrived.as_slice(),
        [ServerFrame::Update { seq: 1, .. }]
    ));
    assert!(
        stall < LONGEST_STALL + quiet,
        "the server's thread was held for {stall:?} while a large change was posted and polled, {quiet:?} with none"
    );
}
