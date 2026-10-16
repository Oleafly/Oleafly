use super::*;

async fn turn_project_comments_off(pair: &Pair, project: SharedProjectId) {
    set_project_comments(pair, project, false).await;
}

async fn a_comment_written_while_comments_are_off_is_dropped_and_every_edit_around_it_arrives(
    blocked: bool,
) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    turn_project_comments_off(&pair, project).await;
    let proxy = proxy_for(&pair).await;
    proxy.block_websockets(blocked);
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    append(&alice, &main, " one");
    let thread = lock(&alice.live)
        .comment_doc()
        .create_comment_thread(
            &main,
            0,
            3,
            pair.alice.tokens.account_id,
            1,
            "written while comments were off",
            &[],
        )
        .unwrap();
    append(&alice, &main, " two");
    start_with(
        &mut bob,
        link_via(&pair, &pair.bob, project, &proxy),
        quick(),
    );
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    let told = until_event(&mut alice, |event| {
        matches!(event, LiveEvent::CommentsNotSent(_))
    })
    .await;
    assert_eq!(
        told,
        LiveEvent::CommentsNotSent(vec![crate::comments::UnsentComment {
            file_id: main.clone(),
            thread_id: thread.id,
            quote: "abc".to_owned(),
            body: "written while comments were off".to_owned(),
        }])
    );
    until_text(&bob, &main, "abc one two").await;
    append(&alice, &main, " three");
    flushed(&alice);
    until_text(&bob, &main, "abc one two three").await;
    acknowledged(&alice).await;
    flushed(&alice);
    tokio::time::sleep(Duration::from_millis(300)).await;
    while let Ok(event) = alice.events.try_recv() {
        assert!(
            !matches!(
                event,
                LiveEvent::CommentsNotSent(_) | LiveEvent::Status(LiveStatus::Offline { .. })
            ),
            "{event:?}"
        );
    }
    assert!(!lock(&alice.live).has_unsent());
    assert_eq!(text(&alice, &main), "abc one two three");
    for person in [&alice, &bob] {
        assert!(lock(&person.live)
            .doc()
            .comment_threads(&main)
            .unwrap()
            .is_empty());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_comment_written_while_comments_are_off_is_dropped_and_every_edit_around_it_arrives_over_a_socket(
) {
    a_comment_written_while_comments_are_off_is_dropped_and_every_edit_around_it_arrives(false)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_comment_written_while_comments_are_off_is_dropped_and_every_edit_around_it_arrives_over_long_poll(
) {
    a_comment_written_while_comments_are_off_is_dropped_and_every_edit_around_it_arrives(true)
        .await;
}

fn write_around_a_comment(side: &Side, main: &str, author: AccountId, round: usize) {
    append(side, main, &format!(" a{round}"));
    lock(&side.live)
        .comment_doc()
        .create_comment_thread(
            main,
            0,
            3,
            author,
            1,
            "written while comments were off",
            &[],
        )
        .unwrap();
    append(side, main, &format!(" b{round}"));
}

async fn went_offline(side: &mut Side) -> bool {
    reached(side, |status| matches!(status, LiveStatus::Offline { .. })).await
}

async fn arrived_promptly(
    alice: &mut Side,
    bob: &Side,
    main: &str,
    round: usize,
    since: tokio::time::Instant,
    mut told: bool,
) {
    let words = format!(" a{round} b{round}");
    loop {
        while let Ok(event) = alice.events.try_recv() {
            told |= matches!(event, LiveEvent::CommentsNotSent(_));
        }
        if told && text(bob, main).contains(&words) {
            break;
        }
        assert!(
            since.elapsed() < PROMPTLY,
            "round {round}: after {:?} Bob had {:?} and Alice was told her comment was not sent: {told}",
            since.elapsed(),
            text(bob, main)
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(lock(&bob.live)
        .doc()
        .comment_threads(main)
        .unwrap()
        .is_empty());
}

async fn the_edits_around_every_refused_comment_arrive_within_seconds(blocked: bool) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
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
    turn_project_comments_off(&pair, project).await;
    append(&bob, &main, " ready");
    flushed(&bob);
    until(|| text(&alice, &main).ends_with(" ready")).await;
    // Every check below runs on the document the server kept from the check
    // of " ready", without reading the project again.
    let snapshots = &pair._server.state().snapshots;
    let reads = snapshots.document_reads();
    let author = pair.alice.tokens.account_id;
    for round in 0..6 {
        let (since, told) = match round {
            0 => {
                proxy.go_offline();
                went_offline(&mut alice).await;
                write_around_a_comment(&alice, &main, author, round);
                proxy.go_online();
                let told = back_online(&mut alice).await;
                (tokio::time::Instant::now(), told)
            }
            1 => {
                set_project_comments(&pair, project, true).await;
                proxy.go_offline();
                went_offline(&mut alice).await;
                write_around_a_comment(&alice, &main, author, round);
                set_project_comments(&pair, project, false).await;
                tokio::time::sleep(Duration::from_millis(1_500)).await;
                proxy.go_online();
                let told = back_online(&mut alice).await;
                (tokio::time::Instant::now(), told)
            }
            2 => {
                proxy.go_offline();
                went_offline(&mut alice).await;
                write_around_a_comment(&alice, &main, author, round);
                proxy.go_online();
                let first = back_online(&mut alice).await;
                proxy.go_offline();
                let dropped = went_offline(&mut alice).await;
                proxy.go_online();
                let again = back_online(&mut alice).await;
                (tokio::time::Instant::now(), first || dropped || again)
            }
            3 => {
                proxy.go_offline();
                went_offline(&mut alice).await;
                proxy.go_online();
                back_online(&mut alice).await;
                write_around_a_comment(&alice, &main, author, round);
                flushed(&alice);
                (tokio::time::Instant::now(), false)
            }
            _ => {
                write_around_a_comment(&alice, &main, author, round);
                flushed(&alice);
                (tokio::time::Instant::now(), false)
            }
        };
        arrived_promptly(&mut alice, &bob, &main, round, since, told).await;
        append(&bob, &main, &format!(" B{round}"));
        flushed(&bob);
        // Alice gets Bob's word before the next round. Otherwise it can reach
        // her between her two appends there, and land between them.
        let bobs = format!(" B{round}");
        until(|| text(&alice, &main).ends_with(&bobs)).await;
    }
    acknowledged(&alice).await;
    until(|| text(&alice, &main) == text(&bob, &main)).await;
    assert_eq!(
        snapshots.document_reads(),
        reads,
        "a comment check read the project again"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_edits_around_every_refused_comment_arrive_within_seconds_over_a_socket() {
    the_edits_around_every_refused_comment_arrive_within_seconds(false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_edits_around_every_refused_comment_arrive_within_seconds_over_long_poll() {
    the_edits_around_every_refused_comment_arrive_within_seconds(true).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_comment_change_is_refused_again_and_the_next_edit_is_checked_without_a_rebuild()
{
    use oleafly_server::comment_guard::Verdict;
    let pair = two_people().await;
    let (project, main, bob_live, _alice_live) = shared(&pair).await;
    let mut doc = ProjectDoc::load(&bob_live.doc().snapshot().unwrap()).unwrap();
    let typed = |doc: &mut ProjectDoc, word: &str| {
        let since = doc.version();
        let typed = format!("{}{word}", doc.text(&main).unwrap());
        doc.set_text(&main, &typed).unwrap();
        doc.export_since(&since).unwrap()
    };
    let state = pair._server.state();
    let check = |payload: Vec<u8>| {
        state
            .comment_guard
            .check(&state.db, &state.snapshots, project, payload)
    };
    let one = typed(&mut doc, " one");
    assert_eq!(check(one.clone()).await.unwrap(), Verdict::Allowed);
    store_on_server(&pair, &pair.bob, signed_envelope(&pair.bob, project, one)).await;
    let reads = state.snapshots.document_reads();
    let mut aside = ProjectDoc::load(&doc.snapshot().unwrap()).unwrap();
    let since = aside.version();
    aside
        .create_comment_thread(&main, 0, 3, pair.bob.tokens.account_id, 1, "no", &[])
        .unwrap();
    let comment = aside.export_since(&since).unwrap();
    for _ in 0..2 {
        assert_eq!(
            check(comment.clone()).await.unwrap(),
            Verdict::ChangesComments
        );
    }
    assert_eq!(
        check(typed(&mut doc, " two")).await.unwrap(),
        Verdict::Allowed
    );
    assert_eq!(
        state.snapshots.document_reads(),
        reads,
        "the checks read the project again"
    );
}
