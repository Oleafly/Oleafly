use super::fake_drive::{FakeDrive, PERMISSION_ID};
use crate::cloud::store::{BatchFile, CloudStore, StoreError, TokenRefresher, WriteMode};
use oleafly_core::content::ContentHash;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

const MIB: usize = 1024 * 1024;

/// Bytes with no short period, so a piece read from the wrong offset can't
/// match by chance.
fn pattern(len: usize, seed: u8) -> Vec<u8> {
    (0..len as u32)
        .map(|index| (index.wrapping_mul(2_654_435_761) >> 24) as u8 ^ seed)
        .collect()
}

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
async fn a_download_runs_past_the_request_timeout_while_bytes_keep_coming() {
    let fake = FakeDrive::start().await;
    let directory = tempfile::tempdir().unwrap();
    let bytes = pattern(64 * 1024, 0);
    let rev = fake
        .store()
        .put(
            "/projects/p/files/data.bin",
            bytes.clone(),
            WriteMode::Overwrite,
        )
        .await
        .unwrap();
    // Eight pieces a quarter second apart take longer than a small request
    // may, and none waits long enough to look stalled.
    fake.with(|drive| drive.media_pace = Some((8 * 1024, Duration::from_millis(250))));
    let store = fake.store_timed(Duration::from_secs(1), Duration::from_secs(3));
    let back = directory.path().join("back.bin");
    let fetched = store
        .fetch_to("/projects/p/files/data.bin", Some(&rev), &back, u64::MAX)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fetched.hash, ContentHash::digest(&bytes));
    assert_eq!(std::fs::read(&back).unwrap(), bytes);

    // One that stops sending fails instead of hanging, and leaves nothing.
    fake.with(|drive| drive.media_pace = Some((8 * 1024, Duration::from_secs(5))));
    let store = fake.store_timed(Duration::from_secs(1), Duration::from_millis(300));
    let stalled = directory.path().join("stalled.bin");
    assert!(matches!(
        store
            .fetch_to("/projects/p/files/data.bin", Some(&rev), &stalled, u64::MAX)
            .await,
        Err(StoreError::Network(_))
    ));
    assert!(!stalled.exists());
}

#[tokio::test]
async fn a_slow_upload_piece_gets_time_for_its_size_not_the_request_timeout() {
    let fake = FakeDrive::start().await;
    let directory = tempfile::tempdir().unwrap();
    let local = directory.path().join("large.bin");
    let bytes = pattern(6 * MIB, 0);
    std::fs::write(&local, &bytes).unwrap();
    // Drive takes longer to answer the piece than a small request may take,
    // and longer than a download may go without a byte.
    fake.with(|drive| drive.piece_delay = Some(Duration::from_millis(2500)));
    let store = fake.store_timed(Duration::from_secs(1), Duration::from_secs(1));
    let uploaded = store
        .put_path("/projects/p/files/large.bin", &local)
        .await
        .unwrap();
    assert_eq!(uploaded.hash, ContentHash::digest(&bytes));
    assert_eq!(
        fake.with(|drive| drive.content("projects/p/files/large.bin")),
        Some(bytes)
    );
}

#[tokio::test]
async fn a_piece_sent_again_is_read_from_the_offset_drive_reports() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    let directory = tempfile::tempdir().unwrap();
    let local = directory.path().join("data.bin");
    let total = 13 * MIB + 5;
    let bytes = pattern(total, 0);
    std::fs::write(&local, &bytes).unwrap();
    fake.with(|drive| {
        drive.piece_faults.extend([
            // Drive persists 3 MiB of the first piece and asks for the rest.
            (3 * MIB, 308),
            // It keeps 1 MiB of the next one, then fails.
            (MIB, 503),
            // The third lands whole.
            (usize::MAX, 308),
            // The last lands too, but its reply is lost.
            (usize::MAX, 503),
        ]);
    });
    let uploaded = store
        .put_path("/projects/p/files/data.bin", &local)
        .await
        .unwrap();
    assert_eq!(uploaded.size, total as u64);
    assert_eq!(uploaded.hash, ContentHash::digest(&bytes));
    fake.with(|drive| {
        assert_eq!(
            drive.pieces,
            [
                (0, 8 * MIB),
                (3 * MIB, 8 * MIB),
                (4 * MIB, 8 * MIB),
                (12 * MIB, MIB + 5)
            ]
        );
        assert_eq!(drive.content("projects/p/files/data.bin"), Some(bytes));
        let copies = drive
            .files
            .values()
            .filter(|file| file.name == "data.bin")
            .count();
        assert_eq!(copies, 1);
    });
}

#[tokio::test]
async fn a_file_that_changes_size_while_it_goes_up_fails_and_drive_keeps_the_old_one() {
    let fake = FakeDrive::start().await;
    let store = fake.store();
    let directory = tempfile::tempdir().unwrap();
    let local = directory.path().join("data.bin");
    let first = pattern(13 * MIB, 0);
    std::fs::write(&local, &first).unwrap();
    store
        .put_path("/projects/p/files/data.bin", &local)
        .await
        .unwrap();
    let second = pattern(13 * MIB, 0x5a);

    // Cut short once the first piece is up: the next piece can't be read.
    std::fs::write(&local, &second).unwrap();
    let cut = local.clone();
    fake.with(|drive| {
        drive.after_piece = Some(Box::new(move || {
            let file = std::fs::OpenOptions::new().write(true).open(cut).unwrap();
            file.set_len(9 * MIB as u64).unwrap();
        }));
    });
    assert!(matches!(
        store.put_path("/projects/p/files/data.bin", &local).await,
        Err(StoreError::Io(_))
    ));

    // Grown once the first piece is up: the last piece is never sent.
    std::fs::write(&local, &second).unwrap();
    let grown = local.clone();
    fake.with(|drive| {
        drive.after_piece = Some(Box::new(move || {
            let mut file = std::fs::OpenOptions::new()
                .append(true)
                .open(grown)
                .unwrap();
            file.write_all(b"more").unwrap();
        }));
    });
    assert!(matches!(
        store.put_path("/projects/p/files/data.bin", &local).await,
        Err(StoreError::Io(_))
    ));
    assert_eq!(
        fake.with(|drive| drive.content("projects/p/files/data.bin")),
        Some(first)
    );

    // Left alone, it goes up.
    std::fs::write(&local, &second).unwrap();
    let uploaded = store
        .put_path("/projects/p/files/data.bin", &local)
        .await
        .unwrap();
    assert_eq!(uploaded.hash, ContentHash::digest(&second));
    assert_eq!(
        fake.with(|drive| drive.content("projects/p/files/data.bin")),
        Some(second)
    );
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

/// A project's files spread over folders that don't exist yet, as on its first
/// upload: `count` files in each folder.
fn project_batch(directory: &std::path::Path) -> Vec<BatchFile> {
    let mut batch = Vec::new();
    for folder in ["figures", "figures/plots", "sections"] {
        for index in 0..8 {
            let local = directory.join(format!("{}-{index}.txt", folder.replace('/', "-")));
            std::fs::write(&local, format!("{folder} {index}")).unwrap();
            batch.push(BatchFile {
                remote: format!("/projects/p/files/{folder}/f{index}.txt"),
                local,
            });
        }
    }
    batch
}

#[tokio::test]
async fn a_batch_makes_each_folder_once_and_looks_up_no_file_by_name() {
    let fake = FakeDrive::start().await;
    let directory = tempfile::tempdir().unwrap();
    let batch = project_batch(directory.path());
    let files = batch.len();

    let before = fake.with(|drive| drive.calls);
    let uploaded = fake.store().put_paths(&batch, &|| {}).await;
    assert!(uploaded.iter().all(Result::is_ok), "{uploaded:?}");
    let first = fake.with(|drive| drive.calls) - before;
    // Uploads that land in the same new folder at once make it once: none is
    // made again and thrown away.
    let (folders, discarded) = fake.with(|drive| {
        let folders = drive.files.values().filter(|file| file.folder).count();
        let discarded = drive
            .files
            .values()
            .filter(|file| file.folder && file.trashed)
            .count();
        (folders, discarded)
    });
    assert_eq!(discarded, 0, "{first} requests for {files} files");
    // Oleafly, projects, p, files, figures, plots and sections.
    assert_eq!(folders, 7);
    // One request per file, and a few per folder: finding it, making it and
    // reading what's in it. No file is looked up by name on its own.
    assert!(
        first <= files + 4 * folders,
        "{first} requests for {files} files"
    );

    // Another computer, or this one after a restart, starts with nothing known:
    // it finds each folder and reads the ones it writes into once, then updates
    // every file with one request each.
    let before = fake.with(|drive| drive.calls);
    let again = fake.store().put_paths(&batch, &|| {}).await;
    assert!(again.iter().all(Result::is_ok), "{again:?}");
    let second = fake.with(|drive| drive.calls) - before;
    assert!(
        second <= files + 2 * folders,
        "{second} requests for {files} files"
    );
    assert_eq!(
        fake.with(|drive| drive.content("projects/p/files/figures/plots/f3.txt")),
        Some(b"figures/plots 3".to_vec())
    );
    assert_eq!(
        fake.with(|drive| drive
            .files
            .values()
            .filter(|file| file.name == "f3.txt")
            .count()),
        3
    );
}
