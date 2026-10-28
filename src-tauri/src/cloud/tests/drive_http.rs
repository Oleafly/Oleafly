use super::fake_drive::{FakeDrive, PERMISSION_ID};
use crate::cloud::store::{BatchFile, CloudStore, StoreError, TokenRefresher, WriteMode};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[tokio::test]
async fn records_are_created_once_read_listed_and_trashed() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    assert!(store
        .get("/projects/p/version.json", 1024)
        .await
        .unwrap()
        .is_none());
    let rev = store
        .put("/projects/p/version.json", b"one".to_vec(), WriteMode::Add)
        .await
        .unwrap();
    assert_eq!(
        store
            .put("/projects/p/version.json", b"two".to_vec(), WriteMode::Add)
            .await,
        Err(StoreError::Conflict)
    );
    let (bytes, read_rev) = store
        .get("/projects/p/version.json", 1024)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(bytes, b"one");
    assert_eq!(read_rev, rev);
    assert_eq!(
        store
            .metadata("/projects/p/version.json")
            .await
            .unwrap()
            .unwrap()
            .size,
        3
    );
    store
        .put(
            "/projects/p/files/main.tex",
            b"tex".to_vec(),
            WriteMode::Overwrite,
        )
        .await
        .unwrap();
    let mut listed = store.list("/projects/p").await.unwrap();
    listed.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(listed.len(), 2);
    assert_eq!((listed[0].name.as_str(), listed[0].folder), ("files", true));
    assert_eq!(
        (listed[1].name.as_str(), listed[1].folder),
        ("version.json", false)
    );
    // Everything lives in one visible folder at the top of My Drive.
    assert_eq!(
        fake.with(|drive| drive.content("projects/p/files/main.tex")),
        Some(b"tex".to_vec())
    );

    assert_eq!(
        store
            .delete("/projects/p/version.json", Some("stale"))
            .await,
        Err(StoreError::Conflict)
    );
    store
        .delete("/projects/p/version.json", Some(&rev))
        .await
        .unwrap();
    assert!(store
        .metadata("/projects/p/version.json")
        .await
        .unwrap()
        .is_none());
    // A folder goes to the trash with everything in it.
    store.delete("/projects/p", None).await.unwrap();
    assert!(store
        .metadata("/projects/p/files/main.tex")
        .await
        .unwrap()
        .is_none());
    assert!(store.list("/projects/p").await.unwrap().is_empty());
    store.delete("/projects/gone", None).await.unwrap();
}

#[tokio::test]
async fn a_stale_update_is_refused_and_a_racing_one_is_undone() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    let first = store
        .put("/projects/p/version.json", b"one".to_vec(), WriteMode::Add)
        .await
        .unwrap();
    let second = store
        .put(
            "/projects/p/version.json",
            b"two".to_vec(),
            WriteMode::Update(first.clone()),
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .put(
                "/projects/p/version.json",
                b"three".to_vec(),
                WriteMode::Update(first)
            )
            .await,
        Err(StoreError::Conflict)
    );

    // Another computer's write lands between the check and this write: the
    // write reports a conflict and theirs ends up on top again.
    fake.with(|drive| drive.race_next_update = Some(b"theirs".to_vec()));
    assert_eq!(
        store
            .put(
                "/projects/p/version.json",
                b"mine".to_vec(),
                WriteMode::Update(second)
            )
            .await,
        Err(StoreError::Conflict)
    );
    assert_eq!(
        fake.with(|drive| drive.content("projects/p/version.json")),
        Some(b"theirs".to_vec())
    );
    let (bytes, head) = store
        .get("/projects/p/version.json", 1024)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(bytes, b"theirs");
    store
        .put(
            "/projects/p/version.json",
            b"merged".to_vec(),
            WriteMode::Update(head),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn a_create_that_races_another_keeps_the_older_file() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    store
        .put("/removed/seed.json", b"{}".to_vec(), WriteMode::Overwrite)
        .await
        .unwrap();
    fake.with(|drive| drive.race_next_create = true);
    assert_eq!(
        store
            .put("/removed/p.json", b"mine".to_vec(), WriteMode::Add)
            .await,
        Err(StoreError::Conflict)
    );
    let (bytes, _) = store.get("/removed/p.json", 1024).await.unwrap().unwrap();
    assert_eq!(bytes, b"theirs");
}

#[tokio::test]
async fn large_files_go_up_in_pieces_and_come_back_whole() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    let directory = tempfile::tempdir().unwrap();
    let local = directory.path().join("large.bin");
    let bytes: Vec<u8> = (0..(13 * 1024 * 1024))
        .map(|index| (index % 251) as u8)
        .collect();
    std::fs::write(&local, &bytes).unwrap();
    let small = directory.path().join("small.txt");
    std::fs::write(&small, b"small").unwrap();
    let uploaded = store
        .put_paths(
            &[
                BatchFile {
                    remote: "/projects/p/files/large.bin".into(),
                    local: local.clone(),
                },
                BatchFile {
                    remote: "/projects/p/files/small.txt".into(),
                    local: small,
                },
            ],
            &|| {},
        )
        .await;
    let large = uploaded[0].as_ref().unwrap();
    assert_eq!(large.size, bytes.len() as u64);
    assert!(uploaded[1].is_ok());
    let back = directory.path().join("back.bin");
    let fetched = store
        .fetch_to(
            "/projects/p/files/large.bin",
            Some(&large.rev),
            &back,
            u64::MAX,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fetched.hash, large.hash);
    assert_eq!(std::fs::read(&back).unwrap(), bytes);
}

#[tokio::test]
async fn the_change_feed_names_the_projects_whose_manifest_changed() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    let project = oleafly_core::ids::ProjectId::new();
    store
        .put(
            &format!("/projects/{project}/files/a.tex"),
            b"a".to_vec(),
            WriteMode::Overwrite,
        )
        .await
        .unwrap();
    let cursor = store.latest_cursor("/projects").await.unwrap().unwrap();
    let quiet = store.wait_for_changes(&cursor, 1).await.unwrap().unwrap();
    assert!(!quiet.changes);

    // Another computer publishes the project.
    let other = fake.store();
    other
        .put(
            &format!("/projects/{project}/version.json"),
            b"{}".to_vec(),
            WriteMode::Add,
        )
        .await
        .unwrap();
    assert!(
        store
            .wait_for_changes(&cursor, 1)
            .await
            .unwrap()
            .unwrap()
            .changes
    );
    let changes = store.changes(&cursor).await.unwrap();
    assert_eq!(changes.paths, [format!("/projects/{project}/version.json")]);
    assert_ne!(changes.cursor, cursor);
    assert!(store
        .changes(&changes.cursor)
        .await
        .unwrap()
        .paths
        .is_empty());
}

#[tokio::test]
async fn an_expired_token_is_renewed_once_and_a_refused_one_means_revoked() {
    let fake = FakeDrive::start().await;
    let renewals = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&renewals);
    let refresher: TokenRefresher = Arc::new(move |_stale| {
        counted.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok("at-1".to_string()) })
    });
    let store = fake.store_with("expired", refresher);
    store
        .put(
            "/settings/settings.json",
            b"{}".to_vec(),
            WriteMode::Overwrite,
        )
        .await
        .unwrap();
    assert_eq!(renewals.load(Ordering::SeqCst), 1);
    fake.with(|drive| drive.token = "at-2".into());
    let refused: TokenRefresher =
        Arc::new(|_stale| Box::pin(async { Ok("still-wrong".to_string()) }));
    let store = fake.store_with("at-1", refused);
    assert_eq!(
        store.metadata("/settings/settings.json").await,
        Err(StoreError::Revoked)
    );
}

#[tokio::test]
async fn the_account_and_its_space_come_from_about() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    let account = store.account().await.unwrap();
    assert_eq!(account.account_id, PERMISSION_ID);
    assert_eq!(account.email, "ada@example.org");
    let space = store.space().await.unwrap().unwrap();
    assert_eq!((space.used, space.allocated), (2048, 16_106_127_360));
}
