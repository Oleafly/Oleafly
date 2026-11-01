use super::fake_s3::{Canned, FakeS3, BUCKET};
use crate::cloud::s3::{ProbeError, S3Store};
use crate::cloud::store::{BatchDelete, BatchFile, CloudStore, StoreError, WriteMode};
use oleafly_core::content::ContentHash;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

const VERSION: &str = "/projects/p/version.json";
const MAIN: &str = "/projects/p/files/main.tex";
const MAIN_KEY: &str = "projects/p/files/main.tex";

fn local_file(dir: &tempfile::TempDir, name: &str, text: &str) -> PathBuf {
    let path = dir.path().join(name);
    std::fs::write(&path, text).unwrap();
    path
}

fn object_of(key: &str, rev: &str) -> String {
    format!("{key}~{}", rev.strip_prefix("o-").unwrap())
}

async fn fetched(
    store: &S3Store,
    remote: &str,
    rev: Option<&str>,
    dir: &tempfile::TempDir,
) -> Option<Vec<u8>> {
    let target = dir
        .path()
        .join(format!("fetched-{:016x}", rand::random::<u64>()));
    store
        .fetch_to(remote, rev, &target, u64::MAX)
        .await
        .unwrap()
        .map(|_| std::fs::read(&target).unwrap())
}

#[tokio::test]
async fn every_upload_goes_to_an_object_of_its_own_until_it_is_retired() {
    let fake = FakeS3::start().await;
    let desk = fake.store("");
    let laptop = fake.store("");
    let dir = tempfile::tempdir().unwrap();
    let first = desk
        .put_path(MAIN, &local_file(&dir, "one.tex", "one"))
        .await
        .unwrap();
    let second = laptop
        .put_path(MAIN, &local_file(&dir, "two.tex", "two"))
        .await
        .unwrap();
    assert_ne!(first.rev, second.rev);
    assert!(desk.valid_rev(&first.rev), "{}", first.rev);
    assert_eq!(
        fetched(&desk, MAIN, Some(&first.rev), &dir).await,
        Some(b"one".to_vec())
    );
    assert_eq!(
        fetched(&laptop, MAIN, Some(&second.rev), &dir).await,
        Some(b"two".to_vec())
    );
    assert_eq!(
        fake.with(|bucket| bucket.read(&object_of(MAIN_KEY, &first.rev))),
        Some(b"one".to_vec())
    );
    assert!(fake.with(|bucket| bucket.read(MAIN_KEY)).is_none());
    assert_eq!(fetched(&desk, MAIN, None, &dir).await, None);

    let meta = desk
        .put_content("/projects/p/files/project.json", b"{}".to_vec())
        .await
        .unwrap();
    assert_eq!(
        fetched(&desk, "/projects/p/files/project.json", Some(&meta), &dir).await,
        Some(b"{}".to_vec())
    );

    let m0 = desk
        .put(VERSION, b"m0".to_vec(), WriteMode::Add)
        .await
        .unwrap();
    desk.retire_versions(&[
        BatchDelete {
            remote: MAIN.into(),
            parent_rev: Some(first.rev.clone()),
        },
        BatchDelete {
            remote: VERSION.into(),
            parent_rev: Some(m0),
        },
        BatchDelete {
            remote: MAIN.into(),
            parent_rev: None,
        },
    ])
    .await;
    assert_eq!(fetched(&desk, MAIN, Some(&first.rev), &dir).await, None);
    assert_eq!(
        fetched(&desk, MAIN, Some(&second.rev), &dir).await,
        Some(b"two".to_vec())
    );
    assert!(desk.get(VERSION, 64).await.unwrap().is_some());

    desk.delete(MAIN, Some(&second.rev)).await.unwrap();
    assert_eq!(fetched(&desk, MAIN, Some(&second.rev), &dir).await, None);
    assert!(fake.with(|bucket| bucket.objects.keys().all(|key| !key.contains("main.tex"))));
}

#[tokio::test]
async fn a_large_upload_completes_into_an_object_of_its_own_with_or_without_a_condition() {
    let fake = FakeS3::start().await;
    let desk = fake.store("");
    let dir = tempfile::tempdir().unwrap();
    let large: Vec<u8> = (0..65 * 1024 * 1024 + 7)
        .map(|index| (index % 251) as u8)
        .collect();
    let local = dir.path().join("large.bin");
    std::fs::write(&local, &large).unwrap();
    let remote = "/projects/p/files/data.bin";
    let small = desk
        .put_path(remote, &local_file(&dir, "small.bin", "laptop data"))
        .await
        .unwrap();

    fake.with(|bucket| bucket.refuse_conditional_completion = true);
    let uploaded = desk.put_path(remote, &local).await.unwrap();
    assert_eq!(uploaded.hash, ContentHash::digest(&large));
    let key = object_of("projects/p/files/data.bin", &uploaded.rev);
    fake.with(|bucket| {
        assert_eq!(bucket.count(&format!("POST {key}?uploadId")), 2);
        assert!(bucket.read(&key).as_deref() == Some(large.as_slice()));
        assert!(bucket.uploads.is_empty());
    });
    assert_eq!(
        fetched(&desk, remote, Some(&small.rev), &dir).await,
        Some(b"laptop data".to_vec())
    );
}

#[tokio::test]
async fn downloads_run_while_bytes_arrive_and_uploads_get_time_for_their_size() {
    let fake = FakeS3::start().await;
    let store = fake
        .store("")
        .with_timeouts(Duration::from_millis(300), Duration::from_millis(1_500));
    let dir = tempfile::tempdir().unwrap();
    let bytes: Vec<u8> = (0..128 * 1024).map(|index| (index % 251) as u8).collect();
    let local = dir.path().join("data.bin");
    std::fs::write(&local, &bytes).unwrap();
    fake.with(|bucket| bucket.slow_writes = Some(Duration::from_millis(900)));
    let uploaded = store
        .put_path("/projects/p/files/data.bin", &local)
        .await
        .unwrap();
    assert_eq!(uploaded.size, bytes.len() as u64);
    fake.with(|bucket| bucket.slow_writes = None);

    fake.with(|bucket| bucket.trickle = Some((8 * 1024, Duration::from_millis(100))));
    let back = dir.path().join("back.bin");
    let fetched = store
        .fetch_to(
            "/projects/p/files/data.bin",
            Some(&uploaded.rev),
            &back,
            u64::MAX,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fetched.hash, ContentHash::digest(&bytes));
    assert!(std::fs::read(&back).unwrap() == bytes);

    fake.with(|bucket| bucket.trickle = Some((8 * 1024, Duration::from_secs(5))));
    let stalled = dir.path().join("stalled.bin");
    let result = store
        .fetch_to(
            "/projects/p/files/data.bin",
            Some(&uploaded.rev),
            &stalled,
            u64::MAX,
        )
        .await;
    assert!(matches!(result, Err(StoreError::Network(_))), "{result:?}");
    assert!(!stalled.exists());
}

#[tokio::test]
async fn records_are_created_once_updated_against_their_version_and_deleted() {
    let fake = FakeS3::start().await;
    let store = fake.store("oleafly");
    assert!(store.get(VERSION, 1024).await.unwrap().is_none());
    assert!(store.metadata(VERSION).await.unwrap().is_none());
    let first = store
        .put(VERSION, b"one".to_vec(), WriteMode::Add)
        .await
        .unwrap();
    assert_eq!(
        store.put(VERSION, b"two".to_vec(), WriteMode::Add).await,
        Err(StoreError::Conflict)
    );
    assert_eq!(
        store.get(VERSION, 1024).await.unwrap(),
        Some((b"one".to_vec(), first.clone()))
    );
    let meta = store.metadata(VERSION).await.unwrap().unwrap();
    assert_eq!((meta.rev.as_str(), meta.size), (first.as_str(), 3));
    assert_eq!(
        store.get(VERSION, 2).await,
        Err(StoreError::Server("the stored record is too large".into()))
    );
    assert_eq!(
        fake.with(|bucket| bucket.read("oleafly/projects/p/version.json")),
        Some(b"one".to_vec())
    );

    let second = store
        .put(VERSION, b"two".to_vec(), WriteMode::Update(first.clone()))
        .await
        .unwrap();
    assert_ne!(second, first);
    assert_eq!(
        store
            .put(VERSION, b"three".to_vec(), WriteMode::Update(first.clone()))
            .await,
        Err(StoreError::Conflict)
    );
    assert_eq!(
        store.delete(VERSION, Some(&first)).await,
        Err(StoreError::Conflict)
    );
    store.delete(VERSION, Some(&second)).await.unwrap();
    assert!(store.get(VERSION, 1024).await.unwrap().is_none());
    store.delete(VERSION, None).await.unwrap();
    store.delete("/projects/p", None).await.unwrap();
}

#[tokio::test]
async fn listings_follow_every_page_and_a_folder_with_files_is_not_deleted_whole() {
    let fake = FakeS3::start().await;
    fake.with(|bucket| bucket.page_size = 2);
    let store = fake.store("");
    for name in ["a.tex", "b.tex", "c.bib", "d.png", "e.md"] {
        store
            .put(
                &format!("/projects/p/files/{name}"),
                name.as_bytes().to_vec(),
                WriteMode::Overwrite,
            )
            .await
            .unwrap();
    }
    store
        .put(
            "/projects/p/files/figures/plot.pdf",
            b"pdf".to_vec(),
            WriteMode::Overwrite,
        )
        .await
        .unwrap();
    let mut listed: Vec<_> = store
        .list("/projects/p/files")
        .await
        .unwrap()
        .into_iter()
        .map(|entry| (entry.name, entry.folder))
        .collect();
    listed.sort();
    assert_eq!(
        listed,
        [
            ("a.tex".to_string(), false),
            ("b.tex".to_string(), false),
            ("c.bib".to_string(), false),
            ("d.png".to_string(), false),
            ("e.md".to_string(), false),
            ("figures".to_string(), true),
        ]
    );
    assert_eq!(fake.with(|bucket| bucket.count("GET ?")), 3);
    assert_eq!(
        store.delete_folder("/projects/p/files").await,
        Err(StoreError::FolderTooLarge)
    );
    store
        .delete("/projects/p/files/figures", Some("\"gone\""))
        .await
        .unwrap();
    store
        .delete("/projects/p/files/figures", None)
        .await
        .unwrap();
    assert_eq!(
        fake.with(|bucket| bucket.read("projects/p/files/figures/plot.pdf")),
        Some(b"pdf".to_vec())
    );
    assert_eq!(store.latest_cursor("/projects").await.unwrap(), None);
    assert_eq!(store.changes("c-1").await.unwrap().cursor, "c-1");
}

#[tokio::test]
async fn files_go_up_whole_or_in_parts_and_come_back_intact() {
    let fake = FakeS3::start().await;
    let store = fake.store("oleafly");
    let dir = tempfile::tempdir().unwrap();
    let small = dir.path().join("main.tex");
    std::fs::write(&small, "\\documentclass{article}").unwrap();
    let notes = dir.path().join("notes.md");
    std::fs::write(&notes, "notes").unwrap();
    let ticks = AtomicUsize::new(0);
    let batch = store
        .put_paths(
            &[
                BatchFile {
                    remote: "/projects/p/files/main.tex".into(),
                    local: small.clone(),
                },
                BatchFile {
                    remote: "/projects/p/files/notes.md".into(),
                    local: notes,
                },
            ],
            &|| {
                ticks.fetch_add(1, Ordering::SeqCst);
            },
        )
        .await;
    assert_eq!(ticks.load(Ordering::SeqCst), 2);
    let uploaded = batch[0].as_ref().unwrap();
    assert_eq!(uploaded.size, 23);
    assert_eq!(
        uploaded.hash,
        ContentHash::digest(b"\\documentclass{article}")
    );
    assert!(batch[1].is_ok());

    let large: Vec<u8> = (0..65 * 1024 * 1024 + 7)
        .map(|index| (index % 251) as u8)
        .collect();
    let local = dir.path().join("large.bin");
    std::fs::write(&local, &large).unwrap();
    let uploaded = store
        .put_path("/projects/p/files/large.bin", &local)
        .await
        .unwrap();
    assert_eq!(uploaded.size, large.len() as u64);
    assert_eq!(uploaded.hash, ContentHash::digest(&large));
    let key = object_of("oleafly/projects/p/files/large.bin", &uploaded.rev);
    fake.with(|bucket| {
        assert_eq!(bucket.count(&format!("POST {key}?uploads")), 1);
        assert_eq!(bucket.count(&format!("PUT {key}?partNumber")), 5);
        assert!(bucket.uploads.is_empty());
    });
    let back = dir.path().join("back.bin");
    let fetched = store
        .fetch_to(
            "/projects/p/files/large.bin",
            Some(&uploaded.rev),
            &back,
            u64::MAX,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fetched.size, large.len() as u64);
    assert!(std::fs::read(&back).unwrap() == large);
    assert!(store
        .fetch_to("/projects/p/files/gone.bin", None, &back, u64::MAX)
        .await
        .unwrap()
        .is_none());

    fake.with(|bucket| bucket.refuse_part = Some(2));
    let refused = store.put_path("/projects/p/files/again.bin", &local).await;
    assert!(
        matches!(&refused, Err(StoreError::Server(detail)) if detail.starts_with("InvalidPart")),
        "{refused:?}"
    );
    fake.with(|bucket| {
        assert!(bucket.uploads.is_empty());
        assert!(bucket
            .objects
            .keys()
            .all(|key| !key.starts_with("oleafly/projects/p/files/again.bin")));
        bucket.refuse_part = None;
        bucket.fail_completion = true;
    });
    // S3 can report a failed completion inside a 200.
    assert_eq!(
        store.put_path("/projects/p/files/again.bin", &local).await,
        Err(StoreError::Server(
            "the storage service didn't finish the upload (InternalError)".into()
        ))
    );
}

#[tokio::test]
async fn service_errors_map_to_what_sync_can_act_on() {
    let fake = FakeS3::start().await;
    let store = fake.store("");
    let cases = [
        (Canned::new(507, ""), StoreError::QuotaFull),
        (Canned::new(400, "XMinioStorageFull"), StoreError::QuotaFull),
        (Canned::new(400, "SlowDown"), StoreError::RateLimited),
        (
            Canned::new(400, "EntityTooLarge"),
            StoreError::Rejected("EntityTooLarge".into()),
        ),
        (
            Canned::new(403, "AccessDenied"),
            StoreError::Server("AccessDenied: AccessDenied from the fake".into()),
        ),
        (Canned::new(403, "InvalidAccessKeyId"), StoreError::Revoked),
        (
            Canned::new(403, "RequestTimeTooSkewed"),
            StoreError::ClockSkew,
        ),
        (Canned::new(400, "RequestExpired"), StoreError::ClockSkew),
        (
            Canned::dated(403, "", "Sun, 06 Nov 1994 08:49:37 GMT"),
            StoreError::ClockSkew,
        ),
        (Canned::new(409, "OperationAborted"), StoreError::Conflict),
        (
            Canned::new(501, ""),
            StoreError::Rejected("NotImplemented: ".into()),
        ),
        (
            Canned::new(400, ""),
            StoreError::Server("the storage service answered 400".into()),
        ),
        (
            Canned::new(400, "InvalidArgument"),
            StoreError::Server("InvalidArgument: InvalidArgument from the fake".into()),
        ),
    ];
    for (canned, expected) in cases {
        fake.with(|bucket| bucket.canned.push_back(canned));
        assert_eq!(
            store
                .put("/r.json", b"x".to_vec(), WriteMode::Overwrite)
                .await,
            Err(expected)
        );
    }

    store
        .put("/r.json", b"kept".to_vec(), WriteMode::Overwrite)
        .await
        .unwrap();
    fake.with(|bucket| {
        bucket.requests.clear();
        bucket
            .canned
            .push_back(Canned::retry_now(500, "InternalError"));
    });
    assert_eq!(
        store
            .get("/r.json", 64)
            .await
            .unwrap()
            .map(|(bytes, _)| bytes),
        Some(b"kept".to_vec())
    );
    assert_eq!(fake.with(|bucket| bucket.count("GET r.json")), 2);
    fake.with(|bucket| {
        for _ in 0..4 {
            bucket.canned.push_back(Canned::retry_now(503, "SlowDown"));
        }
    });
    assert_eq!(store.get("/r.json", 64).await, Err(StoreError::RateLimited));

    let failing = || Canned::new(400, "InvalidArgument");
    let invalid = StoreError::Server("InvalidArgument: InvalidArgument from the fake".into());
    fake.with(|bucket| bucket.canned.push_back(failing()));
    assert_eq!(store.get("/r.json", 64).await, Err(invalid.clone()));
    fake.with(|bucket| bucket.canned.push_back(failing()));
    assert_eq!(
        store.metadata("/r.json").await,
        Err(StoreError::Server(
            "the storage service answered 400".into()
        ))
    );
    fake.with(|bucket| bucket.canned.push_back(failing()));
    assert_eq!(store.list("/projects").await, Err(invalid.clone()));
    fake.with(|bucket| {
        bucket.canned.push_back(Canned::new(200, ""));
        bucket.canned.push_back(failing());
    });
    assert_eq!(store.delete("/r.json", None).await, Err(invalid.clone()));
    let dir = tempfile::tempdir().unwrap();
    fake.with(|bucket| bucket.canned.push_back(failing()));
    assert_eq!(
        store
            .fetch_to("/r.json", None, &dir.path().join("r.json"), 64)
            .await,
        Err(invalid)
    );

    fake.with(|bucket| {
        bucket
            .canned
            .push_back(Canned::dated(403, "", "Sun, 06 Nov 1994 08:49:37 GMT"));
    });
    assert_eq!(store.metadata("/r.json").await, Err(StoreError::ClockSkew));
    fake.with(|bucket| bucket.canned.push_back(Canned::new(403, "")));
    assert!(
        matches!(
            store.metadata("/r.json").await,
            Err(StoreError::Server(detail)) if detail.starts_with("AccessDenied")
        ),
        "a refused read of one file is not the keys being revoked"
    );
    fake.with(|bucket| {
        bucket.canned.push_back(Canned::new(403, ""));
        bucket
            .canned
            .push_back(Canned::new(403, "RequestTimeTooSkewed"));
    });
    assert_eq!(store.metadata("/r.json").await, Err(StoreError::ClockSkew));

    let wrong = fake.store_with_secret("", "not-the-secret");
    assert_eq!(
        wrong
            .put("/r.json", b"x".to_vec(), WriteMode::Overwrite)
            .await,
        Err(StoreError::Revoked)
    );
    assert_eq!(wrong.metadata("/r.json").await, Err(StoreError::Revoked));
}

#[tokio::test]
async fn the_probe_accepts_a_bucket_with_conditional_writes_and_leaves_nothing_behind() {
    let fake = FakeS3::start().await;
    let store = fake.store("oleafly");
    store.probe().await.unwrap();
    fake.with(|bucket| {
        assert!(bucket.objects.is_empty());
        assert_eq!(bucket.count("PUT oleafly/.oleafly-probe-"), 4);
        assert_eq!(bucket.count("DELETE oleafly/.oleafly-probe-"), 1);
    });
    let account = store.account().await.unwrap();
    let host = fake.base.trim_start_matches("http://");
    assert_eq!(account.email, format!("{BUCKET}/oleafly on {host}"));
    assert_eq!(account.account_id, format!("s3:{host}/{BUCKET}/oleafly"));
}

#[tokio::test]
async fn the_probe_names_what_keeps_a_bucket_from_holding_sync() {
    let fake = FakeS3::start().await;
    assert_eq!(
        fake.store_with_secret("", "not-the-secret").probe().await,
        Err(ProbeError::Credentials)
    );

    fake.with(|bucket| bucket.missing = true);
    assert!(matches!(
        fake.store("").probe().await,
        Err(ProbeError::Bucket(detail)) if detail.starts_with("NoSuchBucket")
    ));

    fake.with(|bucket| {
        bucket.missing = false;
        bucket.ignore_conditions = true;
    });
    assert_eq!(
        fake.store("").probe().await,
        Err(ProbeError::NoConditionalWrites(
            "a second create-only write replaced the object".into()
        ))
    );

    fake.with(|bucket| {
        bucket.ignore_conditions = false;
        bucket.ignore_if_match = true;
    });
    assert_eq!(
        fake.store("").probe().await,
        Err(ProbeError::NoConditionalWrites(
            "a write against an old version was accepted".into()
        ))
    );

    fake.with(|bucket| {
        bucket.ignore_if_match = false;
        bucket.refuse_conditions = true;
    });
    assert_eq!(
        fake.store("").probe().await,
        Err(ProbeError::NoConditionalWrites(
            "a create-only write: NotImplemented: NotImplemented from the fake".into()
        ))
    );

    fake.with(|bucket| {
        bucket.refuse_conditions = false;
        bucket
            .canned
            .push_back(Canned::new(403, "RequestTimeTooSkewed"));
    });
    assert_eq!(
        fake.store("").probe().await,
        Err(ProbeError::Failed(StoreError::ClockSkew))
    );

    fake.with(|bucket| bucket.canned.push_back(Canned::new(400, "InvalidArgument")));
    assert_eq!(
        fake.store("").probe().await,
        Err(ProbeError::Failed(StoreError::Server(
            "couldn't list the bucket: InvalidArgument: InvalidArgument from the fake".into()
        )))
    );
    assert!(fake.with(|bucket| bucket.objects.is_empty()));
}
