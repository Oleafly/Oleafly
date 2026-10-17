use super::*;

fn refusable(text: &str, comment: &str) -> (SharedLive, String) {
    let mut doc = ProjectDoc::create().unwrap();
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, "abc")
        .unwrap();
    let mut live = LiveProject::new(doc, 0, ProjectRole::Editor);
    live.local_text(&main, text).unwrap();
    live.comment_doc()
        .create_comment_thread(&main, 0, 3, AccountId::new_v7(), 1, comment, &[])
        .unwrap();
    live.next_outgoing().unwrap().unwrap();
    (Arc::new(Mutex::new(live)), main)
}

#[test]
fn a_viewers_forbidden_refusal_drops_the_batch_keeps_every_change_and_tells_no_one() {
    let (project, main) = refusable("abc typed", "kept here");
    lock(&project).set_role(ProjectRole::Viewer);
    assert_eq!(refused_for(&project, FrameErrorCode::Forbidden), None);
    let mut live = lock(&project);
    assert!(live.next_outgoing().unwrap().is_none());
    assert_eq!(live.doc().text(&main).unwrap(), "abc typed");
    assert_eq!(live.doc().comment_threads(&main).unwrap().len(), 1);
    assert!(live.pending_changes() > 0);
}

#[test]
fn a_comments_off_refusal_drops_only_the_comment_and_names_what_was_written() {
    let (project, main) = refusable("abc typed", "not sent");
    let unsent =
        refused_for(&project, FrameErrorCode::CommentsOff).expect("the comment was taken out");
    assert_eq!(
        unsent
            .iter()
            .map(|comment| comment.body.as_str())
            .collect::<Vec<_>>(),
        vec!["not sent"]
    );
    let mut live = lock(&project);
    assert_eq!(live.doc().text(&main).unwrap(), "abc typed");
    assert!(live.doc().comment_threads(&main).unwrap().is_empty());
    assert!(live.next_outgoing().unwrap().is_some());
}

async fn an_edit_refused_while_its_writer_was_a_viewer_goes_out_once_they_can_edit_again(
    blocked: bool,
) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let upstream = pair
        ._server
        .url()
        .trim_start_matches("http://")
        .parse()
        .unwrap();
    let slow = slow_link(upstream, Duration::from_millis(150)).await;
    let proxy = oleafly_server::test_support::BlockingProxy::start(slow).await;
    proxy.block_websockets(blocked);
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(&pair, &pair.bob, project));
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    until_status(&mut bob, LiveStatus::Online).await;
    back_online(&mut alice).await;
    let client = ServerClient::new(pair.url.clone()).unwrap();
    let grant = |role| {
        client.grant_member(
            &pair.bob.tokens.access_token,
            project,
            pair.alice.tokens.account_id,
            role,
        )
    };
    grant(ProjectRole::Viewer).await.unwrap();
    append(&alice, &main, " kept");
    flushed(&alice);
    until_event(&mut alice, |event| {
        *event == LiveEvent::Role(ProjectRole::Viewer)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(text(&bob, &main), "abc");
    assert!(lock(&alice.live).has_unsent());
    grant(ProjectRole::Editor).await.unwrap();
    until_event(&mut alice, |event| {
        *event == LiveEvent::Role(ProjectRole::Editor)
    })
    .await;
    let since = tokio::time::Instant::now();
    while text(&bob, &main) != "abc kept" {
        assert!(
            since.elapsed() < PROMPTLY,
            "Bob still had {:?} {:?} after Alice could edit again",
            text(&bob, &main),
            since.elapsed()
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    acknowledged(&alice).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_refused_while_its_writer_was_a_viewer_goes_out_once_they_can_edit_again_over_a_socket(
) {
    an_edit_refused_while_its_writer_was_a_viewer_goes_out_once_they_can_edit_again(false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_refused_while_its_writer_was_a_viewer_goes_out_once_they_can_edit_again_over_long_poll(
) {
    an_edit_refused_while_its_writer_was_a_viewer_goes_out_once_they_can_edit_again(true).await;
}
