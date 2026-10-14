use crate::cloud::store::{
    endpoints, test_endpoints, CloudStore, DropboxStore, RemoteEntry, StoreError, StoreResult,
    TokenRefresher, WriteMode, SINGLE_UPLOAD_LIMIT,
};
use crate::cloud::tests::fake_dropbox::{point_at, FakeDropbox, Reply};
use futures_util::future::BoxFuture;
use oleafly_core::content::ContentHash;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

fn store(fake: &FakeDropbox, refresher: Option<TokenRefresher>) -> DropboxStore {
    let token = fake.with(|dropbox| dropbox.mint_token());
    let _pointed = point_at(fake.endpoints());
    DropboxStore::new(token, refresher)
}

fn server_error(result: StoreResult<impl std::fmt::Debug>) -> String {
    match result {
        Err(StoreError::Server(message)) => message,
        other => panic!("expected a server error, got {other:?}"),
    }
}

#[tokio::test]
async fn downloads_return_the_bytes_and_the_revision_dropbox_reports() {
    let fake = FakeDropbox::start().await;
    let rev = fake.with(|dropbox| {
        dropbox.write(
            "/Projects/Café/Main.tex",
            b"\\section{Introduction}".to_vec(),
        )
    });
    let store = store(&fake, None);

    let (bytes, got) = store
        .get("/projects/café/main.tex", 1024)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(bytes, b"\\section{Introduction}");
    assert_eq!(got, rev);
    assert!(store
        .get("/projects/missing.tex", 1024)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        server_error(store.get("/projects/café/main.tex", 4).await),
        "dropbox response is too large"
    );
    fake.with(|dropbox| {
        dropbox.fault("files/download", None, Reply::Raw("<html>busy</html>"), 1);
    });
    assert_eq!(
        server_error(store.get("/projects/café/main.tex", 1024).await),
        "dropbox download reply had no revision"
    );

    let meta = store
        .metadata("/projects/café/main.tex")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(meta.rev, rev);
    assert_eq!(meta.size, 22);
    assert!(store.metadata("/projects/café").await.unwrap().is_none());
    assert!(store.metadata("/nothing/here").await.unwrap().is_none());
    fake.with(|dropbox| {
        dropbox.fault("files/get_metadata", None, Reply::Raw("not json"), 1);
        dropbox.fault(
            "files/get_metadata",
            None,
            Reply::Json(json!({".tag": "file", "rev": "x"})),
            1,
        );
        dropbox.fault("files/get_metadata", None, Reply::Status(400), 1);
    });
    assert_eq!(
        server_error(store.metadata("/projects/café/main.tex").await),
        "dropbox files/get_metadata reply was unreadable"
    );
    assert_eq!(
        server_error(store.metadata("/projects/café/main.tex").await),
        "dropbox metadata had no revision"
    );
    assert_eq!(
        server_error(store.metadata("/projects/café/main.tex").await),
        "dropbox returned status 400"
    );
}

#[tokio::test]
async fn fetching_follows_a_pinned_revision_and_falls_back_to_the_current_file() {
    let fake = FakeDropbox::start().await;
    let path = "/projects/p/files/a.tex";
    let first = fake.with(|dropbox| dropbox.write(path, b"first".to_vec()));
    fake.with(|dropbox| dropbox.write(path, b"second!".to_vec()));
    let store = store(&fake, None);
    let dir = tempfile::tempdir().unwrap();
    let local = |name: &str| dir.path().join(name);

    let pinned = store
        .fetch_to(path, Some(&first), &local("1"), 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(std::fs::read(local("1")).unwrap(), b"first");
    assert_eq!(pinned.hash, ContentHash::digest(b"first"));
    assert_eq!(pinned.size, 5);

    fake.with(|dropbox| dropbox.clear_calls());
    store
        .fetch_to(path, Some("0123456789abcdef"), &local("2"), 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(std::fs::read(local("2")).unwrap(), b"second!");
    assert_eq!(fake.with(|dropbox| dropbox.calls("files/download")), 2);

    store
        .fetch_to(path, Some("not-a-rev"), &local("3"), 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(std::fs::read(local("3")).unwrap(), b"second!");
    assert_eq!(fake.with(|dropbox| dropbox.calls("files/download")), 3);

    assert!(store
        .fetch_to("/projects/p/files/gone.tex", None, &local("4"), 100)
        .await
        .unwrap()
        .is_none());
    assert!(!local("4").exists());

    assert!(matches!(
        store.fetch_to(path, None, &local("5"), 3).await,
        Err(StoreError::Verify(_))
    ));
    assert!(!local("5").exists());
    assert!(matches!(
        store.fetch_to(path, None, &local("1"), 100).await,
        Err(StoreError::Io(_))
    ));

    fake.with(|dropbox| {
        dropbox.fault(
            "files/download",
            None,
            Reply::Refuse("path/restricted_content/.."),
            1,
        );
    });
    store
        .fetch_to(path, Some(&first), &local("6"), 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(std::fs::read(local("6")).unwrap(), b"second!");

    fake.with(|dropbox| {
        dropbox.fault("files/download", None, Reply::Refuse("path/locked/.."), 1);
        dropbox.fault(
            "files/download",
            None,
            Reply::Refuse("path/restricted_content/.."),
            1,
        );
    });
    assert!(matches!(
        store.fetch_to(path, Some(&first), &local("7"), 100).await,
        Err(StoreError::Server(_))
    ));
    assert!(matches!(
        store.fetch_to(path, None, &local("8"), 100).await,
        Err(StoreError::Rejected(summary)) if summary.contains("restricted_content")
    ));
}

#[tokio::test]
async fn puts_honour_add_update_and_overwrite_modes() {
    let fake = FakeDropbox::start().await;
    let store = store(&fake, None);
    let path = "/settings/settings.json";

    let first = store
        .put(path, b"{}".to_vec(), WriteMode::Add)
        .await
        .unwrap();
    assert_eq!(fake.with(|dropbox| dropbox.rev(path)), Some(first.clone()));
    assert_eq!(
        store
            .put(path, b"{\"a\":1}".to_vec(), WriteMode::Add)
            .await
            .unwrap_err(),
        StoreError::Conflict
    );
    let second = store
        .put(
            path,
            b"{\"a\":2}".to_vec(),
            WriteMode::Update(first.clone()),
        )
        .await
        .unwrap();
    assert_ne!(second, first);
    assert_eq!(
        store
            .put(path, b"{\"a\":3}".to_vec(), WriteMode::Update(first))
            .await
            .unwrap_err(),
        StoreError::Conflict
    );
    assert_eq!(
        store
            .put(
                "/settings/other.json",
                b"{}".to_vec(),
                WriteMode::Update(second)
            )
            .await
            .unwrap_err(),
        StoreError::Conflict
    );
    store
        .put(path, b"{\"a\":4}".to_vec(), WriteMode::Overwrite)
        .await
        .unwrap();
    assert_eq!(
        fake.with(|dropbox| dropbox.read(path)),
        Some(b"{\"a\":4}".to_vec())
    );

    fake.with(|dropbox| dropbox.corrupt_hash = true);
    assert!(matches!(
        store
            .put(path, b"{\"a\":5}".to_vec(), WriteMode::Overwrite)
            .await,
        Err(StoreError::Verify(_))
    ));
    fake.with(|dropbox| {
        dropbox.fault("files/upload", None, Reply::Raw("oops"), 1);
        dropbox.fault("files/upload", None, Reply::Json(json!({"size": 1})), 1);
        dropbox.fault(
            "files/upload",
            None,
            Reply::Refuse("path/too_many_write_operations/.."),
            1,
        );
    });
    assert_eq!(
        server_error(store.put(path, b"{}".to_vec(), WriteMode::Overwrite).await),
        "dropbox files/upload reply was unreadable"
    );
    assert_eq!(
        server_error(store.put(path, b"{}".to_vec(), WriteMode::Overwrite).await),
        "dropbox upload reply had no revision"
    );
    fake.with(|dropbox| dropbox.clear_calls());
    assert_eq!(
        store
            .put(path, b"{}".to_vec(), WriteMode::Overwrite)
            .await
            .unwrap_err(),
        StoreError::RateLimited
    );
    assert_eq!(fake.with(|dropbox| dropbox.calls("files/upload")), 1);
}

#[tokio::test]
async fn small_files_upload_whole_and_large_files_go_through_a_session() {
    let fake = FakeDropbox::start().await;
    let store = store(&fake, None);
    let dir = tempfile::tempdir().unwrap();

    let small = dir.path().join("small.tex");
    std::fs::write(&small, b"\\input{intro}").unwrap();
    let uploaded = store
        .put_path("/projects/p/files/small.tex", &small)
        .await
        .unwrap();
    assert_eq!(uploaded.hash, ContentHash::digest(b"\\input{intro}"));
    assert_eq!(uploaded.size, 13);
    assert_eq!(
        fake.with(|dropbox| dropbox.rev("/projects/p/files/small.tex")),
        Some(uploaded.rev)
    );

    let size = usize::try_from(SINGLE_UPLOAD_LIMIT).unwrap() + 1_234;
    let bytes: Vec<u8> = (0..size).map(|index| (index % 251) as u8).collect();
    let large = dir.path().join("figure.pdf");
    std::fs::write(&large, &bytes).unwrap();
    fake.with(|dropbox| dropbox.clear_calls());
    let uploaded = store
        .put_path("/projects/p/files/figure.pdf", &large)
        .await
        .unwrap();
    assert_eq!(uploaded.size, size as u64);
    assert_eq!(uploaded.hash, ContentHash::digest(&bytes));
    fake.with(|dropbox| {
        assert_eq!(dropbox.calls("files/upload"), 0);
        assert_eq!(dropbox.calls("files/upload_session/start"), 1);
        assert_eq!(dropbox.calls("files/upload_session/append_v2"), 1);
        assert_eq!(dropbox.calls("files/upload_session/finish"), 1);
        assert!(dropbox.read("/projects/p/files/figure.pdf") == Some(bytes.clone()));
    });

    assert!(matches!(
        store
            .put_path("/projects/p/files/none.tex", &dir.path().join("none.tex"))
            .await,
        Err(StoreError::Io(_))
    ));
    fake.with(|dropbox| {
        dropbox.fault("files/upload_session/start", None, Reply::Raw(""), 1);
    });
    assert_eq!(
        server_error(store.put_path("/projects/p/files/figure.pdf", &large).await),
        "dropbox upload session reply was unreadable"
    );
    fake.with(|dropbox| {
        dropbox.fault(
            "files/upload_session/append_v2",
            None,
            Reply::Refuse("lookup_failed/incorrect_offset/.."),
            1,
        );
    });
    assert!(matches!(
        store.put_path("/projects/p/files/figure.pdf", &large).await,
        Err(StoreError::Server(_))
    ));
    fake.with(|dropbox| dropbox.quota = Some(1024));
    assert_eq!(
        store
            .put_path("/projects/p/files/figure2.pdf", &large)
            .await
            .unwrap_err(),
        StoreError::QuotaFull
    );
}

#[tokio::test]
async fn listings_page_through_folders_and_deletes_tolerate_missing_paths() {
    let fake = FakeDropbox::start().await;
    fake.with(|dropbox| {
        dropbox.write("/projects/b/version.json", b"{}".to_vec());
        dropbox.write("/projects/a/files/main.tex", b"x".to_vec());
        dropbox.write("/projects/a/version.json", b"{}".to_vec());
        dropbox.write("/projects/c.json", b"{}".to_vec());
        dropbox.write("/projects/D/version.json", b"{}".to_vec());
        dropbox.page_size = 2;
        dropbox.list_noise = true;
    });
    let store = store(&fake, None);

    let entries = store.list("/projects").await.unwrap();
    let entry = |name: &str, folder: bool| RemoteEntry {
        name: name.into(),
        folder,
    };
    assert_eq!(
        entries,
        vec![
            entry("a", true),
            entry("b", true),
            entry("c.json", false),
            entry("D", true)
        ]
    );
    fake.with(|dropbox| {
        assert_eq!(dropbox.calls("files/list_folder"), 1);
        assert_eq!(dropbox.calls("files/list_folder/continue"), 1);
    });
    assert!(store.list("/nowhere").await.unwrap().is_empty());

    fake.with(|dropbox| {
        dropbox.fault(
            "files/list_folder",
            None,
            Reply::Json(json!({"entries": [], "has_more": true})),
            1,
        );
        dropbox.fault(
            "files/list_folder",
            None,
            Reply::Refuse("path/malformed_path/.."),
            1,
        );
        dropbox.fault(
            "files/list_folder/continue",
            None,
            Reply::Refuse("reset/.."),
            1,
        );
        dropbox.fault(
            "files/list_folder/continue",
            None,
            Reply::Refuse("path/not_found/.."),
            1,
        );
    });
    assert_eq!(
        server_error(store.list("/projects").await),
        "dropbox list reply was unreadable"
    );
    assert!(matches!(
        store.list("/projects").await,
        Err(StoreError::Rejected(_))
    ));
    assert_eq!(
        store.list("/projects").await.unwrap_err(),
        StoreError::Reset
    );
    assert_eq!(
        server_error(store.list("/projects").await),
        "dropbox could not find the item"
    );

    store.delete("/projects/c.json", None).await.unwrap();
    store.delete("/projects/A", None).await.unwrap();
    store.delete("/projects/never", None).await.unwrap();
    fake.with(|dropbox| {
        assert!(dropbox.read("/projects/c.json").is_none());
        assert!(dropbox.read("/projects/a/files/main.tex").is_none());
        assert!(dropbox.read("/projects/a/version.json").is_none());
        assert!(dropbox.read("/projects/b/version.json").is_some());
        dropbox.fault(
            "files/delete_v2",
            None,
            Reply::Refuse("path_lookup/restricted_content/.."),
            1,
        );
        dropbox.fault("files/delete_v2", None, Reply::Status(400), 1);
    });
    assert!(matches!(
        store.delete("/projects/b", None).await,
        Err(StoreError::Rejected(_))
    ));
    assert!(matches!(
        store.delete("/projects/b", None).await,
        Err(StoreError::Server(_))
    ));
}

#[tokio::test]
async fn change_cursors_report_new_and_deleted_paths_until_dropbox_resets_them() {
    let fake = FakeDropbox::start().await;
    let store = store(&fake, None);
    assert!(store.latest_cursor("/projects").await.unwrap().is_none());

    fake.with(|dropbox| dropbox.write("/projects/a/version.json", b"{}".to_vec()));
    let cursor = store.latest_cursor("/projects").await.unwrap().unwrap();
    let quiet = store.changes(&cursor).await.unwrap();
    assert!(quiet.paths.is_empty());
    assert_eq!(quiet.cursor, cursor);

    fake.with(|dropbox| {
        dropbox.write("/projects/a/files/Main.tex", b"x".to_vec());
        dropbox.write("/projects/b/version.json", b"{}".to_vec());
        dropbox.remove("/projects/a/files/main.tex");
        dropbox.write("/settings/settings.json", b"{}".to_vec());
        dropbox.page_size = 1;
        dropbox.clear_calls();
    });
    let changes = store.changes(&cursor).await.unwrap();
    assert_eq!(
        changes.paths,
        vec![
            "/projects/a/files/main.tex".to_string(),
            "/projects/b/version.json".to_string(),
            "/projects/a/files/main.tex".to_string(),
        ]
    );
    assert_eq!(
        fake.with(|dropbox| dropbox.calls("files/list_folder/continue")),
        3
    );
    assert!(store
        .changes(&changes.cursor)
        .await
        .unwrap()
        .paths
        .is_empty());

    fake.with(|dropbox| dropbox.reset_cursors());
    assert_eq!(
        store.changes(&changes.cursor).await.unwrap_err(),
        StoreError::Reset
    );
    assert!(matches!(
        store.changes("garbage").await,
        Err(StoreError::Server(_))
    ));
    fake.with(|dropbox| {
        dropbox.fault(
            "files/list_folder/get_latest_cursor",
            None,
            Reply::Refuse("path/malformed_path/.."),
            1,
        );
        dropbox.fault(
            "files/list_folder/get_latest_cursor",
            None,
            Reply::Json(json!({})),
            1,
        );
    });
    assert!(matches!(
        store.latest_cursor("/projects").await,
        Err(StoreError::Rejected(_))
    ));
    assert!(store.latest_cursor("/projects").await.unwrap().is_none());
}

#[tokio::test]
async fn rate_limits_and_server_errors_are_retried_before_they_are_reported() {
    let fake = FakeDropbox::start().await;
    let path = "/projects/p/version.json";
    fake.with(|dropbox| {
        dropbox.write(path, b"{}".to_vec());
        dropbox.fault("files/get_metadata", None, Reply::Status(429), 3);
    });
    let store = store(&fake, None);

    assert!(store.metadata(path).await.unwrap().is_some());
    assert_eq!(fake.with(|dropbox| dropbox.calls("files/get_metadata")), 4);

    fake.with(|dropbox| {
        dropbox.fault("files/get_metadata", None, Reply::Status(429), 4);
        dropbox.fault("files/get_metadata", None, Reply::Status(503), 4);
    });
    assert_eq!(
        store.metadata(path).await.unwrap_err(),
        StoreError::RateLimited
    );
    assert_eq!(
        server_error(store.metadata(path).await),
        "dropbox returned status 503"
    );
    assert!(store.metadata(path).await.unwrap().is_some());
}

#[tokio::test]
async fn an_expired_token_is_refreshed_once_and_a_second_refusal_means_revoked() {
    let fake = FakeDropbox::start().await;
    let path = "/projects/p/version.json";
    fake.with(|dropbox| dropbox.write(path, b"{}".to_vec()));
    let calls = Arc::new(AtomicUsize::new(0));
    let refreshing = store(&fake, Some(fake.refresher(Arc::clone(&calls))));

    fake.with(|dropbox| dropbox.expire_tokens());
    assert!(refreshing.metadata(path).await.unwrap().is_some());
    assert!(refreshing.metadata(path).await.unwrap().is_some());
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let stale: TokenRefresher = Arc::new(|| -> BoxFuture<'static, StoreResult<String>> {
        Box::pin(async { Ok("sl.stale".to_string()) })
    });
    let refused = store(&fake, Some(stale));
    let failing: TokenRefresher = Arc::new(|| -> BoxFuture<'static, StoreResult<String>> {
        Box::pin(async { Err(StoreError::Network("offline".into())) })
    });
    let offline = store(&fake, Some(failing));
    let bare = store(&fake, None);
    fake.with(|dropbox| dropbox.expire_tokens());
    assert_eq!(
        refused.metadata(path).await.unwrap_err(),
        StoreError::Revoked
    );
    assert_eq!(
        offline.metadata(path).await.unwrap_err(),
        StoreError::Network("offline".into())
    );
    assert_eq!(bare.metadata(path).await.unwrap_err(), StoreError::Revoked);
}

#[tokio::test]
async fn full_dropboxes_and_refused_names_map_to_their_own_errors() {
    let fake = FakeDropbox::start().await;
    let store = store(&fake, None);
    fake.with(|dropbox| {
        dropbox.quota = Some(16);
        dropbox.rejected_names.insert("desktop.ini".into());
    });

    let full = store
        .put(
            "/projects/p/files/big.bin",
            vec![7; 64],
            WriteMode::Overwrite,
        )
        .await
        .unwrap_err();
    assert_eq!(full, StoreError::QuotaFull);
    assert_eq!(full.code(), "cloud.quota_full");
    let refused = store
        .put(
            "/projects/p/files/Desktop.ini",
            b"[x]".to_vec(),
            WriteMode::Overwrite,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&refused, StoreError::Rejected(summary) if summary.contains("disallowed_name"))
    );
    assert_eq!(refused.code(), "cloud.server");
    assert!(!refused.ends_round());
    store
        .put("/projects/p/files/ok.tex", b"ok".to_vec(), WriteMode::Add)
        .await
        .unwrap();
}

#[test]
fn store_errors_carry_their_codes_messages_and_round_rules() {
    let cases = [
        (
            StoreError::Revoked,
            "cloud.revoked",
            "dropbox access was revoked",
            true,
        ),
        (
            StoreError::Network("offline".into()),
            "cloud.network",
            "offline",
            true,
        ),
        (
            StoreError::Server("busy".into()),
            "cloud.server",
            "busy",
            false,
        ),
        (
            StoreError::Io("disk".into()),
            "cloud.local_io",
            "disk",
            false,
        ),
        (
            StoreError::QuotaFull,
            "cloud.quota_full",
            "dropbox is full",
            false,
        ),
        (
            StoreError::RateLimited,
            "cloud.rate_limited",
            "dropbox asked to slow down",
            true,
        ),
        (
            StoreError::Conflict,
            "cloud.remote_busy",
            "the remote record changed",
            false,
        ),
        (
            StoreError::Rejected("name".into()),
            "cloud.server",
            "name",
            false,
        ),
        (
            StoreError::Verify("bytes".into()),
            "cloud.verify_failed",
            "bytes",
            false,
        ),
        (
            StoreError::Reset,
            "cloud.server",
            "the change cursor was reset",
            false,
        ),
    ];
    for (error, code, message, ends) in cases {
        assert_eq!(error.code(), code);
        assert_eq!(error.to_string(), message);
        assert_eq!(error.ends_round(), ends, "{error:?}");
        let app: serde_json::Value = serde_json::from_str(
            error
                .to_app_error()
                .strip_prefix(crate::app_error::PREFIX)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(app["code"], code);
    }
}

#[test]
fn without_an_override_the_store_talks_to_dropbox_itself() {
    let _pointed = point_at(crate::cloud::store::Endpoints {
        api: String::new(),
        content: String::new(),
        token: String::new(),
    });
    test_endpoints::set(None);
    let real = endpoints();
    assert_eq!(real.api, "https://api.dropboxapi.com/2");
    assert_eq!(real.content, "https://content.dropboxapi.com/2");
    assert_eq!(real.token, "https://api.dropboxapi.com/oauth2/token");
}
