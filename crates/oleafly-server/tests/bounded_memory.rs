mod large_changes;
mod people;

use large_changes::{
    append_large_changes, budget, build_every, hinted, kept_from, newest_snapshot, opened_doc,
    shared_with_alice,
};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_server::projects;
use people::{connect, next_frame, stage, subscribe};

#[tokio::test]
async fn a_backlog_page_stops_near_its_byte_budget_however_many_rows_fit() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let doc = opened_doc();
    append_large_changes(&stage, &doc, project, 1..=24, 1 << 20).await;
    let mut after = 0;
    let mut pages = 0;
    while after < 24 {
        let page = stage
            .server
            .state()
            .db
            .call(move |conn| projects::updates_since(conn, project, after))
            .await
            .expect("a page");
        assert!(!page.is_empty(), "a page after {after} came back empty");
        let sizes: Vec<usize> = page.iter().map(|update| update.envelope.len()).collect();
        let before_last: usize = sizes[..sizes.len() - 1].iter().sum();
        assert!(
            before_last < projects::BACKLOG_BYTES,
            "a page held {} bytes before its last change ({} changes)",
            before_last,
            sizes.len()
        );
        for (update, expected) in page.iter().zip(after + 1..) {
            assert_eq!(update.seq, expected);
        }
        after = page.last().map_or(after, |update| update.seq);
        pages += 1;
    }
    assert!(pages >= 4, "24 changes of 1 MB came back in {pages} pages");
}

#[tokio::test]
async fn a_device_catching_up_over_byte_sized_pages_gets_every_change_in_order() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let doc = opened_doc();
    append_large_changes(&stage, &doc, project, 1..=24, 1 << 20).await;
    let mut late = connect(&stage.server, &stage.bob).await;
    assert!(matches!(
        subscribe(&mut late, project, 0).await,
        ServerFrame::Subscribed { head_seq: 24, .. }
    ));
    let mut expected = 1;
    while expected <= 24 {
        match next_frame(&mut late).await {
            Some(ServerFrame::Update { seq, .. }) => {
                assert_eq!(seq, expected, "the backlog skipped or repeated a change");
                expected += 1;
            }
            Some(ServerFrame::Presence { .. } | ServerFrame::PresenceLeft { .. }) => {}
            other => panic!("expected change {expected}, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn a_snapshot_too_large_to_build_in_memory_is_put_off_and_the_log_kept() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    build_every(&stage, 10);
    budget(&stage, 4 << 20, 200 << 20);
    let doc = opened_doc();
    append_large_changes(&stage, &doc, project, 1..=12, 64 << 10).await;
    assert_eq!(hinted(&stage, project, 12).await, Some(0));
    assert_eq!(hinted(&stage, project, 12).await, Some(0));
    assert_eq!(kept_from(&stage, project).await, Some(1));
    assert_eq!(newest_snapshot(&stage, project).await.0, Some(0));

    budget(&stage, 1 << 30, 200 << 20);
    append_large_changes(&stage, &doc, project, 13..=22, 64 << 10).await;
    assert_eq!(hinted(&stage, project, 22).await, Some(22));
    let (seq, bytes) = newest_snapshot(&stage, project).await;
    assert_eq!(seq, Some(22));
    assert_eq!(people::text_of(&bytes), doc.get_text("text").to_string());
}

#[tokio::test]
async fn a_built_snapshot_larger_than_a_project_may_be_is_not_stored() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    build_every(&stage, 10);
    budget(&stage, 1 << 30, 1 << 20);
    let doc = opened_doc();
    append_large_changes(&stage, &doc, project, 1..=12, 128 << 10).await;
    assert_eq!(hinted(&stage, project, 12).await, Some(0));
    assert_eq!(kept_from(&stage, project).await, Some(1));
    let (seq, bytes) = newest_snapshot(&stage, project).await;
    assert_eq!(seq, Some(0));
    assert_eq!(people::text_of(&bytes), people::SNAPSHOT_TEXT);
}

#[tokio::test]
async fn the_server_builds_snapshots_within_its_configured_memory_and_project_size() {
    let mut config = oleafly_server::test_support::test_config();
    config.snapshot_memory_mb = 64;
    config.limits.max_project_mb = 7;
    let app = oleafly_server::test_support::test_app_with(config).await;
    assert_eq!(
        app.state.snapshots.budget(),
        oleafly_server::snapshots::Budget {
            memory_bytes: 64 << 20,
            max_snapshot_bytes: 7 << 20,
        }
    );
}
