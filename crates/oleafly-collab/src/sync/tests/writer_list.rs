use super::*;

struct LateJoin {
    project: SharedProjectId,
    main: String,
    honest: oleafly_collab_protocol::ids::CommentId,
    forged: oleafly_collab_protocol::ids::CommentId,
    initial: Vec<u8>,
    typed: String,
    tablet: Person,
    _writers: (Side, Side),
}

async fn comments_then_a_snapshot(pair: &Pair) -> LateJoin {
    snapshot_often(pair);
    let (project, main, bob_live, alice_live) = shared(pair).await;
    let initial = bob_live.doc().snapshot().unwrap();
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
    start(&mut bob, link(pair, &pair.bob, project));
    start(&mut alice, link(pair, &pair.alice, project));
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    let (alice_account, bob_account) = (pair.alice.tokens.account_id, pair.bob.tokens.account_id);
    let (honest, forged) = {
        let mut live = lock(&alice.live);
        let doc = live.comment_doc();
        let honest = doc
            .create_comment_thread(&main, 0, 1, alice_account, 1, "Mine", &[])
            .unwrap();
        let forged = doc
            .create_comment_thread(&main, 1, 2, bob_account, 2, "Pretending to be Bob", &[])
            .unwrap();
        (honest.id, forged.id)
    };
    alice.handle.as_ref().unwrap().flush();
    until_event(&mut alice, |event| *event == LiveEvent::Acknowledged).await;
    tokio::time::timeout(WAIT, async {
        while lock(&bob.live)
            .doc()
            .comment_thread(&main, forged)
            .ok()
            .flatten()
            .is_none()
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("Bob received Alice's comments");
    for letter in ["x", "y"] {
        let typed = format!("{}{letter}", text(&bob, &main));
        lock(&bob.live).local_text(&main, &typed).unwrap();
        bob.handle.as_ref().unwrap().flush();
        until_event(&mut bob, |event| *event == LiveEvent::Acknowledged).await;
    }
    let client = ServerClient::new(pair.url.clone()).unwrap();
    let head = lock(&bob.live).last_seq();
    client
        .snapshot_hint(&pair.bob.tokens.access_token, project, head - 1)
        .await
        .unwrap();
    client
        .snapshot_hint(&pair.bob.tokens.access_token, project, head)
        .await
        .unwrap();
    let tablet = another_alice_device(pair).await;
    let (seq, _) = client
        .get_snapshot(&tablet.tokens.access_token, project)
        .await
        .unwrap();
    assert_eq!(seq, head);
    LateJoin {
        project,
        typed: text(&bob, &main),
        main,
        honest,
        forged,
        initial,
        tablet,
        _writers: (alice, bob),
    }
}

impl LateJoin {
    fn joiner(&self) -> Side {
        side(
            LiveProject::new(
                ProjectDoc::load(&self.initial).unwrap(),
                0,
                ProjectRole::Editor,
            ),
            &self.main,
        )
    }

    fn thread(
        &self,
        late: &Side,
        id: oleafly_collab_protocol::ids::CommentId,
    ) -> Option<crate::comments::CommentThread> {
        lock(&late.live)
            .doc()
            .comment_thread(&self.main, id)
            .ok()
            .flatten()
    }

    async fn first_sight(&self, late: &Side) -> crate::comments::CommentThread {
        tokio::time::timeout(WAIT, async {
            loop {
                if let Some(thread) = self.thread(late, self.forged) {
                    return thread;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the comments arrived")
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_late_joiner_sees_comment_authors_as_verified_only_when_the_server_vouches() {
    let pair = two_people().await;
    let join = comments_then_a_snapshot(&pair).await;
    let mut late = join.joiner();
    start(&mut late, link(&pair, &join.tablet, join.project));
    let first_sight = join.first_sight(&late).await;
    assert!(!first_sight.verified);
    assert!(!first_sight.messages[0].verified);
    until_text(&late, &join.main, &join.typed).await;
    let seen_honest = join.thread(&late, join.honest).unwrap();
    let seen_forged = join.thread(&late, join.forged).unwrap();
    assert!(seen_honest.verified);
    assert!(seen_honest.messages[0].verified);
    assert!(!seen_forged.verified);
    assert!(!seen_forged.messages[0].verified);
}

#[tokio::test(flavor = "multi_thread")]
async fn comments_stay_unverified_while_the_writer_list_cannot_be_fetched_and_verify_once_it_arrives(
) {
    let pair = two_people().await;
    let join = comments_then_a_snapshot(&pair).await;
    let proxy = crate::client::test_util::PathProxy::start(&pair._server.url(), "/peers").await;
    proxy.answer(Some("503 Service Unavailable"));
    let mut through = link(&pair, &join.tablet, join.project);
    through.client = Arc::new(ServerClient::new(proxy.url.clone()).unwrap());
    let mut late = join.joiner();
    start(&mut late, through);
    assert!(!join.first_sight(&late).await.verified);
    until_text(&late, &join.main, &join.typed).await;
    assert!(!join.thread(&late, join.honest).unwrap().verified);
    assert!(!join.thread(&late, join.forged).unwrap().verified);
    proxy.answer(None);
    until(|| {
        join.thread(&late, join.honest)
            .is_some_and(|thread| thread.verified)
    })
    .await;
    assert!(!join.thread(&late, join.forged).unwrap().verified);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_writer_list_missing_when_sync_connects_is_asked_for_again_until_it_arrives() {
    let pair = two_people().await;
    let (project, main, bob_live, _alice_live) = shared(&pair).await;
    let proxy = crate::client::test_util::PathProxy::start(&pair._server.url(), "/peers").await;
    proxy.answer(Some("503 Service Unavailable"));
    let mut through = link(&pair, &pair.bob, project);
    through.client = Arc::new(ServerClient::new(proxy.url.clone()).unwrap());
    let mut bob = side(bob_live, &main);
    start(&mut bob, through);
    until_status(&mut bob, LiveStatus::Online).await;
    assert!(!lock(&bob.live).peers_vouched());
    proxy.answer(None);
    until(|| lock(&bob.live).peers_vouched()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn asking_again_for_the_writer_list_stops_when_live_sync_stops() {
    let pair = two_people().await;
    let join = comments_then_a_snapshot(&pair).await;
    let proxy = crate::client::test_util::PathProxy::start(&pair._server.url(), "/peers").await;
    proxy.answer(Some("503 Service Unavailable"));
    let mut through = link(&pair, &join.tablet, join.project);
    through.client = Arc::new(ServerClient::new(proxy.url.clone()).unwrap());
    let mut late = join.joiner();
    start(&mut late, through);
    join.first_sight(&late).await;
    until(|| proxy.answered() >= 2).await;
    late.handle.take().unwrap().stopped().await;
    let asked = proxy.answered();
    tokio::time::sleep(Duration::from_millis(3_500)).await;
    assert_eq!(proxy.answered(), asked);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_writer_list_answered_with_not_found_leaves_every_comment_author_unverified() {
    let pair = two_people().await;
    let join = comments_then_a_snapshot(&pair).await;
    let proxy = crate::client::test_util::PathProxy::start(&pair._server.url(), "/peers").await;
    proxy.answer(Some("404 Not Found"));
    let mut through = link(&pair, &join.tablet, join.project);
    through.client = Arc::new(ServerClient::new(proxy.url.clone()).unwrap());
    let mut late = join.joiner();
    start(&mut late, through);
    assert!(!join.first_sight(&late).await.verified);
    until_text(&late, &join.main, &join.typed).await;
    let forged = join.thread(&late, join.forged).unwrap();
    assert!(!forged.verified);
    assert!(!forged.messages[0].verified);
    assert!(!join.thread(&late, join.honest).unwrap().verified);
    assert!(!lock(&late.live).peers_vouched());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_change_from_a_new_writer_waits_whenever_the_server_gives_no_writer_list() {
    let pair = two_people().await;
    let (project, main, bob_live, mut alice_live) = shared(&pair).await;
    alice_live.local_text(&main, "abcX").unwrap();
    let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
    let envelope = signed_envelope(&pair.alice, project, payload);
    let bob = side(bob_live, &main);
    for status in ["404 Not Found", "500 Internal Server Error"] {
        let answer = canned(http_response(
            status,
            &[("content-type", "application/json")],
            r#"{"code":"not_found","message":"Not found."}"#,
        ))
        .await;
        let mut failing = link(&pair, &pair.bob, project);
        failing.client = Arc::new(ServerClient::new(answer).unwrap());
        let verdict = peer_trust(&failing, &bob.live, &mut BTreeSet::new(), &envelope).await;
        assert!(
            matches!(verdict, Trust::Unreachable),
            "{status} must hold the change back"
        );
    }
    let current = link(&pair, &pair.bob, project);
    let verdict = peer_trust(&current, &bob.live, &mut BTreeSet::new(), &envelope).await;
    assert!(matches!(verdict, Trust::Signed(_)));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_writer_id_is_looked_up_alone_once_the_whole_list_was_seen() {
    let pair = two_people().await;
    let (project, main, bob_live, mut alice_live) = shared(&pair).await;
    let alice_peer = alice_live.doc().peer_id();
    alice_live.local_text(&main, "abcX").unwrap();
    let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
    let envelope = signed_envelope(&pair.alice, project, payload);
    let row = serde_json::json!([{
        "peer": alice_peer,
        "device_id": pair.alice.tokens.device_id,
        "account_id": pair.alice.tokens.account_id,
    }])
    .to_string();
    let path: &'static str =
        Box::leak(format!("/api/v1/projects/{project}/peers").into_boxed_str());
    for vouched in [false, true] {
        let bob = side(
            LiveProject::new(
                ProjectDoc::load(&bob_live.doc().snapshot().unwrap()).unwrap(),
                0,
                ProjectRole::Owner,
            ),
            &main,
        );
        if vouched {
            lock(&bob.live).pin_peers(Vec::new());
        }
        let reply = http_response("200 OK", &[("content-type", "application/json")], &row);
        let (url, heard) = crate::client::test_util::routed(|_| vec![(path, vec![reply])]).await;
        let mut asking = link(&pair, &pair.bob, project);
        asking.client = Arc::new(ServerClient::new(url).unwrap());
        let verdict = peer_trust(&asking, &bob.live, &mut BTreeSet::new(), &envelope).await;
        assert!(matches!(verdict, Trust::Signed(_)));
        let heard = heard.lock().unwrap().clone();
        assert_eq!(heard.len(), 1, "{heard:?}");
        let target = heard[0].split_whitespace().nth(1).unwrap().to_owned();
        if vouched {
            assert_eq!(target, format!("{path}?ids={alice_peer}"));
        } else {
            assert_eq!(target, path);
        }
        assert!(lock(&bob.live).peers_vouched());
        let again = peer_trust(&asking, &bob.live, &mut BTreeSet::new(), &envelope).await;
        assert!(matches!(again, Trust::Signed(_)));
        assert_eq!(heard.len(), 1);
    }
}
