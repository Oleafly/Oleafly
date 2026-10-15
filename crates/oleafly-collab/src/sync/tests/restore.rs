use super::*;

async fn backup(pair: &Pair) -> (tempfile::TempDir, std::path::PathBuf) {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("backup.sqlite3");
    let target = path.to_string_lossy().into_owned();
    pair._server
        .state()
        .db
        .call(move |conn| {
            conn.execute("VACUUM INTO ?1", [target])?;
            Ok(())
        })
        .await
        .expect("backed up");
    (folder, path)
}

async fn restore(pair: &Pair, saved: &std::path::Path) {
    let source = saved.to_string_lossy().into_owned();
    pair._server
        .state()
        .db
        .call(move |conn| {
            conn.execute("ATTACH DATABASE ?1 AS saved", [source])?;
            let tables: Vec<String> = {
                let mut listed = conn.prepare(
                    "SELECT name FROM saved.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                )?;
                let names = listed.query_map([], |row| row.get(0))?;
                names.collect::<Result<_, _>>()?
            };
            conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN;")?;
            for table in &tables {
                conn.execute_batch(&format!(
                    "DELETE FROM main.\"{table}\"; INSERT INTO main.\"{table}\" SELECT * FROM saved.\"{table}\";"
                ))?;
            }
            conn.execute_batch("COMMIT; PRAGMA foreign_keys = ON; DETACH DATABASE saved;")?;
            Ok(())
        })
        .await
        .expect("restored");
}

async fn type_rounds(bob: &Side, alice: &Side, main: &str, rounds: std::ops::Range<u32>) {
    for round in rounds {
        append(bob, main, &format!(" b{round}"));
        flushed(bob);
        append(alice, main, &format!(" a{round}"));
        flushed(alice);
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
}

async fn settled(sides: &[&Side], main: &str) {
    tokio::time::timeout(WAIT * 3, async {
        loop {
            let first = text(sides[0], main);
            let same = sides.iter().all(|side| text(side, main) == first);
            let sent = sides.iter().all(|side| !lock(&side.live).has_unsent());
            if same && sent {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        let texts: Vec<String> = sides.iter().map(|side| text(side, main)).collect();
        panic!("the copies never settled: {texts:#?}")
    });
}

fn holds_every_word(merged: &str, rounds: std::ops::Range<u32>, people: &[char]) {
    for round in rounds {
        for person in people {
            let word = format!(" {person}{round}");
            assert!(
                merged.contains(&word),
                "{word:?} is missing from {merged:?}"
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_database_restored_from_an_older_backup_leaves_every_copy_identical_and_loses_no_acknowledged_edit(
) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    proxy.block_websockets(false);
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
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
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    type_rounds(&bob, &alice, &main, 0..6).await;
    settled(&[&bob, &alice], &main).await;
    let (_kept, saved) = backup(&pair).await;
    let at_backup = lock(&bob.live).last_seq();
    type_rounds(&bob, &alice, &main, 6..12).await;
    settled(&[&bob, &alice], &main).await;
    assert!(lock(&bob.live).last_seq() > at_backup);
    restore(&pair, &saved).await;
    proxy.go_offline();
    proxy.go_online();
    for round in 12..15 {
        append(&alice, &main, &format!(" a{round}"));
        flushed(&alice);
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let tablet = another_alice_device(&pair).await;
    let client = ServerClient::new(pair.url.clone()).unwrap();
    let (seq, snapshot) = client
        .get_snapshot(&tablet.tokens.access_token, project)
        .await
        .unwrap();
    let mut late = side(
        LiveProject::new(
            ProjectDoc::load(&snapshot).unwrap(),
            seq,
            ProjectRole::Editor,
        ),
        &main,
    );
    start(&mut late, link(&pair, &tablet, project));
    settled(&[&bob, &alice, &late], &main).await;
    let merged = text(&bob, &main);
    holds_every_word(&merged, 0..12, &['a', 'b']);
    holds_every_word(&merged, 12..15, &['a']);
}

async fn restored_pair() -> (
    Pair,
    SharedProjectId,
    String,
    Side,
    Side,
    oleafly_server::test_support::BlockingProxy,
) {
    let pair = two_people().await;
    let (project, main, bob_live, alice_live) = shared(&pair).await;
    let proxy = proxy_for(&pair).await;
    proxy.block_websockets(false);
    let mut bob = side(bob_live, &main);
    let mut alice = side(alice_live, &main);
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
    until_status(&mut bob, LiveStatus::Online).await;
    until_status(&mut alice, LiveStatus::Online).await;
    type_rounds(&bob, &alice, &main, 0..4).await;
    settled(&[&bob, &alice], &main).await;
    (pair, project, main, bob, alice, proxy)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_is_noticed_even_after_the_others_pushed_the_head_past_this_copys_last_change() {
    let (pair, project, main, bob, mut alice, proxy) = restored_pair().await;
    let (_kept, saved) = backup(&pair).await;
    for round in 4..8 {
        append(&bob, &main, &format!(" b{round}"));
        flushed(&bob);
        acknowledged(&bob).await;
    }
    settled(&[&bob, &alice], &main).await;
    let alice_last = lock(&alice.live).last_seq();
    stopped(&mut alice).await;
    restore(&pair, &saved).await;
    proxy.go_offline();
    proxy.go_online();
    let mut round = 8;
    tokio::time::timeout(WAIT * 3, async {
        while lock(&bob.live).last_seq() <= alice_last {
            append(&bob, &main, &format!(" b{round}"));
            flushed(&bob);
            round += 1;
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .expect("the server's head moved past Alice's last change");
    settled(&[&bob], &main).await;
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    settled(&[&bob, &alice], &main).await;
    let merged = text(&bob, &main);
    holds_every_word(&merged, 0..4, &['a', 'b']);
    holds_every_word(&merged, 4..round, &['b']);
}

#[tokio::test(flavor = "multi_thread")]
async fn after_a_restore_changes_built_on_a_lost_change_wait_for_its_author_and_nothing_is_lost() {
    let (pair, project, main, bob, mut alice, proxy) = restored_pair().await;
    let (_kept, saved) = backup(&pair).await;
    type_rounds(&bob, &alice, &main, 4..8).await;
    settled(&[&bob, &alice], &main).await;
    stopped(&mut alice).await;
    restore(&pair, &saved).await;
    proxy.go_offline();
    proxy.go_online();
    for round in 8..11 {
        append(&bob, &main, &format!(" b{round}"));
        flushed(&bob);
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        lock(&bob.live).pending_changes() > 0,
        "Bob's new words build on Alice's lost ones and must wait for her"
    );
    start_with(
        &mut alice,
        link_via(&pair, &pair.alice, project, &proxy),
        quick(),
    );
    settled(&[&bob, &alice], &main).await;
    let merged = text(&bob, &main);
    holds_every_word(&merged, 0..8, &['a', 'b']);
    holds_every_word(&merged, 8..11, &['b']);
    let tablet = another_alice_device(&pair).await;
    let client = ServerClient::new(pair.url.clone()).unwrap();
    let (seq, snapshot) = client
        .get_snapshot(&tablet.tokens.access_token, project)
        .await
        .unwrap();
    let mut late = side(
        LiveProject::new(
            ProjectDoc::load(&snapshot).unwrap(),
            seq,
            ProjectRole::Editor,
        ),
        &main,
    );
    start(&mut late, link(&pair, &tablet, project));
    settled(&[&bob, &alice, &late], &main).await;
}
