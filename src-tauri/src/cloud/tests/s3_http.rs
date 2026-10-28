use super::fake_s3::{Canned, FakeS3, BUCKET};
use crate::cloud::s3::ProbeError;
use crate::cloud::store::{BatchFile, CloudStore, StoreError, WriteMode};
use oleafly_core::content::ContentHash;
use std::sync::atomic::{AtomicUsize, Ordering};

const VERSION: &str = "/projects/p/version.json";

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
    // Everything lives under the folder the connection names.
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
    // Deleting what is already gone, file or folder, is not an error.
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
        store.delete("/projects/p/files", None).await,
        Err(StoreError::FolderTooLarge)
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

    // Over 64 MiB: five parts of at most 16 MiB.
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
    assert!(uploaded.rev.ends_with("-5\""), "{}", uploaded.rev);
    fake.with(|bucket| {
        assert_eq!(
            bucket.count("POST oleafly/projects/p/files/large.bin?uploads"),
            1
        );
        assert_eq!(
            bucket.count("PUT oleafly/projects/p/files/large.bin?partNumber"),
            5
        );
        assert!(bucket.uploads.is_empty());
    });
    let back = dir.path().join("back.bin");
    let fetched = store
        .fetch_to("/projects/p/files/large.bin", None, &back, u64::MAX)
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

    // A refused part abandons the upload instead of leaving it open.
    fake.with(|bucket| bucket.refuse_part = Some(2));
    let refused = store.put_path("/projects/p/files/again.bin", &local).await;
    assert!(
        matches!(&refused, Err(StoreError::Server(detail)) if detail.starts_with("InvalidPart")),
        "{refused:?}"
    );
    fake.with(|bucket| {
        assert!(bucket.uploads.is_empty());
        assert!(bucket.read("oleafly/projects/p/files/again.bin").is_none());
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

    // Busy answers are retried when the service says to come back now.
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
    // A HEAD reply has no body, so only the status gets through.
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

    // Keys the service doesn't recognise end the connection, not one write.
    let wrong = fake.store_with_secret("", "not-the-secret");
    assert_eq!(
        wrong
            .put("/r.json", b"x".to_vec(), WriteMode::Overwrite)
            .await,
        Err(StoreError::Revoked)
    );
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

    // Backblaze B2 answers conditional writes with 501.
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
        bucket.canned.push_back(Canned::new(400, "InvalidArgument"));
    });
    assert_eq!(
        fake.store("").probe().await,
        Err(ProbeError::Failed(StoreError::Server(
            "couldn't list the bucket: InvalidArgument: InvalidArgument from the fake".into()
        )))
    );
    assert!(fake.with(|bucket| bucket.objects.is_empty()));
}
