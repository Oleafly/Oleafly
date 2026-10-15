use super::*;
use crate::doc::failpoint::{panic_on, At};
use crate::live::save_shared;

async fn events_until_ended(side: &mut Side) -> Vec<LiveEvent> {
    let mut heard = Vec::new();
    tokio::time::timeout(WAIT, async {
        while let Some(event) = side.events.recv().await {
            let ended = matches!(event, LiveEvent::Status(LiveStatus::Ended { .. }));
            heard.push(event);
            if ended {
                return;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("the session never ended, it heard {heard:?}"));
    heard
}

#[tokio::test(flavor = "multi_thread")]
async fn a_change_the_engine_panics_on_ends_the_session_and_the_next_start_skips_it() {
    let pair = two_people().await;
    let (project, main, mut bob_live, mut alice_live) = shared(&pair).await;
    let dir = tempfile::tempdir().unwrap();
    bob_live.save(dir.path()).unwrap();
    alice_live.local_text(&main, "abc boom").unwrap();
    let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
    panic_on(&payload, At::Document);
    let envelope = signed_envelope(&pair.alice, project, payload);
    store_on_server(&pair, &pair.alice, envelope).await;
    let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
    let mut bob = side(loaded, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    let heard = events_until_ended(&mut bob).await;
    assert_eq!(
        heard.last(),
        Some(&LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::Failed
        }))
    );
    assert!(heard.iter().any(|event| matches!(
        event,
        LiveEvent::Unreadable { device_id, .. } if *device_id == Some(pair.alice.tokens.device_id)
    )));
    assert!(lock(&bob.live).damaged());
    save_shared(&bob.live, dir.path()).unwrap();
    stopped(&mut bob).await;
    let reloaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
    let mut restarted = side(reloaded, &main);
    start(&mut restarted, link(&pair, &pair.bob, project));
    until_status(&mut restarted, LiveStatus::Online).await;
    append(&restarted, &main, " later");
    flushed(&restarted);
    acknowledged(&restarted).await;
    assert_eq!(text(&restarted, &main), "abc later");
    assert!(!lock(&restarted.live).damaged());
    stopped(&mut restarted).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_change_that_makes_the_decoder_panic_is_skipped_and_the_session_carries_on() {
    let pair = two_people().await;
    let (project, main, mut bob_live, mut alice_live) = shared(&pair).await;
    let dir = tempfile::tempdir().unwrap();
    bob_live.save(dir.path()).unwrap();
    alice_live.local_text(&main, "abc boom").unwrap();
    let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
    panic_on(&payload, At::Decode);
    let envelope = signed_envelope(&pair.alice, project, payload);
    store_on_server(&pair, &pair.alice, envelope).await;
    let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
    let mut bob = side(loaded, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    let mut heard = Vec::new();
    tokio::time::timeout(WAIT, async {
        while let Some(event) = bob.events.recv().await {
            heard.push(event);
            let online = heard.contains(&LiveEvent::Status(LiveStatus::Online));
            let reported = heard
                .iter()
                .any(|event| matches!(event, LiveEvent::Unreadable { .. }));
            if online && reported {
                return;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("bob heard {heard:?}"));
    assert!(heard.iter().any(|event| matches!(
        event,
        LiveEvent::Unreadable { device_id, .. } if *device_id == Some(pair.alice.tokens.device_id)
    )));
    assert!(!heard
        .iter()
        .any(|event| matches!(event, LiveEvent::Status(LiveStatus::Ended { .. }))));
    append(&bob, &main, " later");
    flushed(&bob);
    acknowledged(&bob).await;
    assert_eq!(text(&bob, &main), "abc later");
    assert!(!lock(&bob.live).damaged());
    save_shared(&bob.live, dir.path()).unwrap();
    stopped(&mut bob).await;
    let reloaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
    let mut restarted = side(reloaded, &main);
    start(&mut restarted, link(&pair, &pair.bob, project));
    until_status(&mut restarted, LiveStatus::Online).await;
    append(&restarted, &main, " again");
    flushed(&restarted);
    acknowledged(&restarted).await;
    assert_eq!(text(&restarted, &main), "abc later again");
    assert!(!lock(&restarted.live).damaged());
    stopped(&mut restarted).await;
}
