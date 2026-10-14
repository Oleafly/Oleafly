mod people;

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::{header, Request};
use loro::{ExportMode, LoroDoc};
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::ids::{BatchId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectStatus;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::blobs::{sha256_hex, snapshot_key};
use oleafly_server::build_router;
use oleafly_server::clock::ManualClock;
use oleafly_server::config::{BlobStoreConfig, ServerConfig};
use oleafly_server::projects;
use oleafly_server::snapshots::{Policy, Upload};
use oleafly_server::state::{AppState, DATABASE_FILE, DAY_MS};
use oleafly_server::test_support::{
    seed_member, test_config, MockS3, MockS3Fault, SeededMember, TestApp, TEST_START_MS,
};
use oleafly_server::tokens::random_token;
use people::{call, create_project, first_snapshot, share_project, stage_with, Stage};
use reqwest::{Method, StatusCode};
use rusqlite::params;
use tempfile::TempDir;
use tower::ServiceExt;

const PREFIX: &str = "oleafly";
const SNAPSHOT_OFTEN: Policy = Policy {
    build_after: 1,
    keep_updates: 1,
};
const SEQ_HEADER: &str = "x-oleafly-snapshot-seq";

enum Store {
    Disk,
    Bucket(MockS3),
}

impl Store {
    async fn both() -> [Store; 2] {
        [Store::Disk, Store::Bucket(MockS3::start().await)]
    }

    fn configure(&self, config: &mut ServerConfig, data_dir: &Path) {
        config.data_dir = data_dir.to_path_buf();
        if let Store::Bucket(bucket) = self {
            config.blob_store = BlobStoreConfig::S3(Box::new(bucket.config(PREFIX)));
        }
    }

    fn bucket(&self) -> &MockS3 {
        match self {
            Store::Bucket(bucket) => bucket,
            Store::Disk => panic!("this store has no bucket"),
        }
    }

    fn key(project: SharedProjectId, hash: &str) -> String {
        format!("{PREFIX}/{}", snapshot_key(project, hash))
    }

    fn holds(&self, data_dir: &Path, project: SharedProjectId, hash: &str) -> Option<Vec<u8>> {
        match self {
            Store::Disk => {
                std::fs::read(data_dir.join("blobs").join(snapshot_key(project, hash))).ok()
            }
            Store::Bucket(bucket) => bucket.object(&Store::key(project, hash)),
        }
    }

    fn tamper(&self, data_dir: &Path, project: SharedProjectId, hash: &str) {
        match self {
            Store::Disk => std::fs::write(
                data_dir.join("blobs").join(snapshot_key(project, hash)),
                b"tampered",
            )
            .expect("tamper with the stored snapshot"),
            Store::Bucket(bucket) => bucket.insert_object(&Store::key(project, hash), b"tampered"),
        }
    }

    fn count(&self, data_dir: &Path, project: SharedProjectId) -> usize {
        match self {
            Store::Disk => std::fs::read_dir(
                data_dir
                    .join("blobs")
                    .join("snapshots")
                    .join(project.to_string()),
            )
            .map(Iterator::count)
            .unwrap_or(0),
            Store::Bucket(bucket) => bucket
                .keys()
                .iter()
                .filter(|key| key.starts_with(&format!("{PREFIX}/snapshots/{project}/")))
                .count(),
        }
    }
}

struct Site {
    data: TempDir,
    stage: Stage,
}

struct Stored {
    status: StatusCode,
    seq: Option<u64>,
}

impl Site {
    async fn start(store: &Store) -> Site {
        let data = tempfile::tempdir().expect("data folder");
        let mut config = test_config();
        store.configure(&mut config, data.path());
        let stage = stage_with(config).await;
        stage.server.state().snapshots.set_policy(SNAPSHOT_OFTEN);
        Site { data, stage }
    }

    fn dir(&self) -> &Path {
        self.data.path()
    }

    fn state(&self) -> &AppState {
        self.stage.server.state()
    }

    async fn share(&self, title: &str) -> SharedProjectId {
        share_project(&self.stage.server, &self.stage.bob, title)
            .await
            .project_id
    }

    async fn upload(&self, project: SharedProjectId, seq: u64, bytes: &[u8]) -> Stored {
        let state = self.state();
        let stored = state
            .snapshots
            .upload(
                &state.db,
                project,
                seq,
                axum::body::Bytes::copy_from_slice(bytes),
                self.stage.bob.tokens.account_id,
                TEST_START_MS,
            )
            .await;
        match stored {
            Ok(Upload::Stored) => Stored {
                status: StatusCode::NO_CONTENT,
                seq: Some(seq),
            },
            Ok(Upload::Held(held)) => Stored {
                status: StatusCode::NO_CONTENT,
                seq: Some(held),
            },
            Err(error) => Stored {
                status: StatusCode::from_u16(error.status().as_u16()).expect("status"),
                seq: None,
            },
        }
    }

    async fn download(&self, project: SharedProjectId) -> (StatusCode, Option<u64>, Vec<u8>) {
        let response = call(
            &self.stage.server,
            Method::GET,
            &format!("/api/v1/projects/{project}/snapshot"),
            self.stage.bob.token(),
            None,
        )
        .await;
        let status = response.status();
        let seq = seq_header(response.headers());
        (status, seq, response.bytes().await.expect("body").to_vec())
    }

    async fn append(&self, project: SharedProjectId, count: usize) {
        let device = self.stage.bob.tokens.device_id;
        let account = self.stage.bob.tokens.account_id;
        self.state()
            .db
            .call(move |conn| {
                for index in 0..count {
                    projects::append_update(
                        conn,
                        project,
                        BatchId::new_v7(),
                        device,
                        account,
                        format!("change {index}").as_bytes(),
                        TEST_START_MS,
                    )?;
                }
                Ok(())
            })
            .await
            .expect("append updates");
    }
}

fn seq_header(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get(SEQ_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

async fn rows(state: &AppState, project: SharedProjectId) -> Vec<(u64, Option<String>)> {
    state
        .db
        .call(move |conn| {
            let mut statement = conn.prepare(
                "SELECT seq, hash FROM project_snapshots WHERE project_id = ?1 ORDER BY seq",
            )?;
            let found = statement
                .query_map([project.to_string()], |row| {
                    Ok((
                        u64::try_from(row.get::<_, i64>(0)?).unwrap_or(0),
                        row.get::<_, Option<String>>(1)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(found)
        })
        .await
        .expect("snapshot rows")
}

async fn files(state: &AppState, project: SharedProjectId) -> Vec<String> {
    state
        .db
        .call(move |conn| {
            let mut statement = conn
                .prepare("SELECT file FROM project_snapshots WHERE project_id = ?1 ORDER BY seq")?;
            let found = statement
                .query_map([project.to_string()], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(found)
        })
        .await
        .expect("snapshot files")
}

async fn oldest_kept(state: &AppState, project: SharedProjectId) -> Option<u64> {
    state
        .db
        .call(move |conn| projects::oldest_kept_update(conn, project))
        .await
        .expect("oldest kept update")
}

fn hashed(bytes: &[u8]) -> Option<String> {
    Some(sha256_hex(bytes))
}

#[tokio::test]
async fn snapshots_round_trip_through_the_blob_store_on_both_stores() {
    for store in Store::both().await {
        let site = Site::start(&store).await;
        let project = site.share("Thesis").await;
        let hash = sha256_hex(&first_snapshot());
        assert_eq!(
            store.holds(site.dir(), project, &hash),
            Some(first_snapshot())
        );
        assert!(!site.dir().join("snapshots").exists());
        assert_eq!(
            rows(site.state(), project).await,
            vec![(0, Some(hash.clone()))]
        );
        assert_eq!(
            files(site.state(), project).await,
            vec![snapshot_key(project, &hash)]
        );
        assert_eq!(
            site.download(project).await,
            (StatusCode::OK, Some(0), first_snapshot())
        );
    }
}

#[tokio::test]
async fn a_tampered_snapshot_is_refused_and_readers_fall_back_to_the_one_before() {
    for store in Store::both().await {
        let site = Site::start(&store).await;
        let project = site.share("Thesis").await;
        site.append(project, 3).await;
        assert_eq!(
            site.upload(project, 2, b"state at two").await.status,
            StatusCode::NO_CONTENT
        );
        store.tamper(site.dir(), project, &sha256_hex(b"state at two"));
        assert_eq!(
            site.download(project).await,
            (StatusCode::OK, Some(0), first_snapshot())
        );
        store.tamper(site.dir(), project, &sha256_hex(&first_snapshot()));
        assert_eq!(
            site.download(project).await.0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}

#[tokio::test]
async fn compaction_keeps_updates_when_the_newest_snapshot_cannot_be_read() {
    for store in Store::both().await {
        let site = Site::start(&store).await;
        let healthy = site.share("Healthy").await;
        site.append(healthy, 6).await;
        site.upload(healthy, 2, b"healthy two").await;
        site.upload(healthy, 4, b"healthy four").await;
        assert_eq!(oldest_kept(site.state(), healthy).await, Some(3));

        let project = site.share("Thesis").await;
        site.append(project, 6).await;
        site.upload(project, 2, b"two").await;
        assert_eq!(oldest_kept(site.state(), project).await, Some(1));
        store.tamper(site.dir(), project, &sha256_hex(b"two"));
        assert_eq!(
            site.upload(project, 4, b"four").await.status,
            StatusCode::NO_CONTENT
        );
        assert_eq!(oldest_kept(site.state(), project).await, Some(1));
        assert_eq!(
            site.download(project).await,
            (StatusCode::OK, Some(4), b"four".to_vec())
        );
        site.state().run_maintenance().await.expect("maintenance");
        let seqs: Vec<u64> = rows(site.state(), project)
            .await
            .into_iter()
            .map(|(seq, _)| seq)
            .collect();
        assert_eq!(seqs, vec![0, 2, 4]);
        store.tamper(site.dir(), project, &sha256_hex(b"four"));
        assert_eq!(
            site.download(project).await,
            (StatusCode::OK, Some(0), first_snapshot())
        );
    }
}

#[tokio::test]
async fn an_upload_the_bucket_loses_is_refused_and_compacts_nothing() {
    let store = Store::Bucket(MockS3::start().await);
    let site = Site::start(&store).await;
    let project = site.share("Thesis").await;
    site.append(project, 4).await;
    site.upload(project, 2, b"two").await;
    store.bucket().set_fault(Some(MockS3Fault::LoseWrites));
    assert_eq!(
        site.upload(project, 4, b"four").await.status,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    store.bucket().set_fault(None);
    let seqs: Vec<u64> = rows(site.state(), project)
        .await
        .into_iter()
        .map(|(seq, _)| seq)
        .collect();
    assert_eq!(seqs, vec![0, 2]);
    assert_eq!(oldest_kept(site.state(), project).await, Some(1));
    assert_eq!(
        site.download(project).await,
        (StatusCode::OK, Some(2), b"two".to_vec())
    );
}

#[tokio::test]
async fn maintenance_keeps_the_newest_two_snapshots_of_each_project() {
    for store in Store::both().await {
        let site = Site::start(&store).await;
        let project = site.share("Thesis").await;
        let untouched = site.share("Notes").await;
        site.append(project, 6).await;
        site.upload(project, 2, b"same state").await;
        site.upload(project, 4, b"same state").await;
        site.upload(project, 6, b"six").await;
        assert_eq!(
            rows(site.state(), project).await,
            vec![(4, hashed(b"same state")), (6, hashed(b"six"))]
        );
        site.state().run_maintenance().await.expect("maintenance");
        assert_eq!(
            rows(site.state(), project).await,
            vec![(4, hashed(b"same state")), (6, hashed(b"six"))]
        );
        assert_eq!(
            store.holds(site.dir(), project, &sha256_hex(&first_snapshot())),
            None
        );
        assert_eq!(
            store.holds(site.dir(), project, &sha256_hex(b"same state")),
            Some(b"same state".to_vec())
        );
        assert_eq!(store.count(site.dir(), project), 2);
        assert_eq!(
            rows(site.state(), untouched).await,
            vec![(0, hashed(&first_snapshot()))]
        );
        assert_eq!(
            store.holds(site.dir(), untouched, &sha256_hex(&first_snapshot())),
            Some(first_snapshot())
        );
        site.state()
            .run_maintenance()
            .await
            .expect("maintenance again");
        assert_eq!(rows(site.state(), project).await.len(), 2);
        assert_eq!(store.count(site.dir(), project), 2);
        assert_eq!(
            site.download(project).await,
            (StatusCode::OK, Some(6), b"six".to_vec())
        );
    }
}

#[tokio::test]
async fn everyone_closing_at_once_leaves_one_snapshot_for_that_seq() {
    for store in Store::both().await {
        let site = Site::start(&store).await;
        let project = site.share("Thesis").await;
        site.append(project, 3).await;
        let closing: Vec<Vec<u8>> = (0..6)
            .map(|person| format!("closed by person {person}").into_bytes())
            .collect();
        let replies = futures_util::future::join_all(
            closing.iter().map(|bytes| site.upload(project, 3, bytes)),
        )
        .await;
        for reply in &replies {
            assert_eq!(reply.status, StatusCode::NO_CONTENT);
            assert_eq!(reply.seq, Some(3));
        }
        let kept = rows(site.state(), project).await;
        assert_eq!(kept.len(), 2);
        let (status, _, stored) = site.download(project).await;
        assert_eq!(status, StatusCode::OK);
        assert!(closing.contains(&stored));
        assert_eq!(kept[1], (3, hashed(&stored)));
        let late = site.upload(project, 3, b"closed later").await;
        assert_eq!(late.status, StatusCode::NO_CONTENT);
        let older = site.upload(project, 2, b"an older state").await;
        assert_eq!(older.status, StatusCode::NO_CONTENT);
        assert_eq!(older.seq, Some(3));
        assert_eq!(rows(site.state(), project).await, kept);
        assert_eq!(store.count(site.dir(), project), 2);

        store.tamper(site.dir(), project, &sha256_hex(&stored));
        assert_eq!(
            site.upload(project, 3, b"repaired").await.status,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            rows(site.state(), project).await,
            vec![(0, hashed(&first_snapshot())), (3, hashed(b"repaired"))]
        );
        assert_eq!(store.holds(site.dir(), project, &sha256_hex(&stored)), None);
        assert_eq!(store.count(site.dir(), project), 2);
        assert_eq!(
            site.download(project).await,
            (StatusCode::OK, Some(3), b"repaired".to_vec())
        );
    }
}

#[tokio::test]
async fn the_server_says_which_snapshot_it_holds_without_reading_it() {
    let store = Store::Bucket(MockS3::start().await);
    let site = Site::start(&store).await;
    let head = |project: SharedProjectId, token: String| {
        let url = format!(
            "{}/api/v1/projects/{project}/snapshot",
            site.stage.server.url()
        );
        async move {
            reqwest::Client::new()
                .head(url)
                .bearer_auth(token)
                .send()
                .await
                .expect("head")
        }
    };
    let bob = site.stage.bob.token().to_string();
    let draft = create_project(&site.stage.server, &site.stage.bob, "Draft")
        .await
        .project_id;
    assert_eq!(
        head(draft, bob.clone()).await.status(),
        StatusCode::NOT_FOUND
    );
    let project = site.share("Thesis").await;
    let held = head(project, bob.clone()).await;
    assert_eq!(held.status(), StatusCode::OK);
    assert_eq!(seq_header(held.headers()), Some(0));
    assert!(held.bytes().await.expect("body").is_empty());
    site.append(project, 3).await;
    site.upload(project, 3, b"three").await;
    store.bucket().set_fault(Some(MockS3Fault::AccessDenied));
    let held = head(project, bob.clone()).await;
    assert_eq!(held.status(), StatusCode::OK);
    assert_eq!(seq_header(held.headers()), Some(3));
    store.bucket().set_fault(None);
    assert_eq!(
        head(project, site.stage.alice.token().to_string())
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn an_expired_project_takes_its_snapshots_with_it() {
    for store in Store::both().await {
        let site = Site::start(&store).await;
        let project = site.share("Thesis").await;
        site.append(project, 2).await;
        site.upload(project, 2, b"two").await;
        assert_eq!(store.count(site.dir(), project), 2);
        let archive = format!("/api/v1/projects/{project}/archive");
        assert_eq!(
            call(
                &site.stage.server,
                Method::POST,
                &archive,
                site.stage.bob.token(),
                None
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        site.stage.server.clock().advance(31 * DAY_MS);
        let report = site.state().run_maintenance().await.expect("maintenance");
        assert_eq!(report.expired_projects, 1);
        assert_eq!(store.count(site.dir(), project), 0);
        assert!(rows(site.state(), project).await.is_empty());
    }
}

async fn boot(config: &ServerConfig) -> TestApp {
    let clock = ManualClock::new(TEST_START_MS);
    let state = AppState::new(config.clone(), clock.clone())
        .await
        .expect("the server starts");
    TestApp {
        router: build_router(state.clone()),
        state,
        clock,
    }
}

async fn fetch(
    app: &TestApp,
    method: Method,
    path: &str,
    token: &str,
    body: Vec<u8>,
) -> (StatusCode, Option<u64>, Vec<u8>) {
    let request = Request::builder()
        .method(method.as_str())
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(body))
        .expect("request");
    let response = app
        .router
        .clone()
        .oneshot(request)
        .await
        .expect("the router answers");
    let status = StatusCode::from_u16(response.status().as_u16()).expect("status");
    let seq = response
        .headers()
        .get(SEQ_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok());
    let bytes = axum::body::to_bytes(response.into_body(), 64 << 20)
        .await
        .expect("body");
    (status, seq, bytes.to_vec())
}

async fn snapshot_of(
    app: &TestApp,
    owner: &SeededMember,
    project: SharedProjectId,
) -> (Option<u64>, Vec<u8>) {
    let (status, seq, bytes) = fetch(
        app,
        Method::GET,
        &format!("/api/v1/projects/{project}/snapshot"),
        &owner.access_token,
        Vec::new(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (seq, bytes)
}

async fn project_with_lines(
    app: &TestApp,
    owner: &SeededMember,
    title: &str,
    lines: u64,
) -> SharedProjectId {
    let account = owner.account_id;
    let device = owner.device_id;
    let title = title.to_string();
    app.state
        .db
        .call(move |conn| {
            let project = projects::create_pending(conn, account, &title, TEST_START_MS)?;
            projects::set_status(conn, project, ProjectStatus::Active, TEST_START_MS)?;
            for line in 1..=lines {
                projects::append_update(
                    conn,
                    project,
                    BatchId::new_v7(),
                    device,
                    account,
                    format!("line {line}\n").as_bytes(),
                    TEST_START_MS,
                )?;
            }
            Ok(project)
        })
        .await
        .expect("a project with lines")
}

async fn legacy_snapshot(
    app: &TestApp,
    data_dir: &Path,
    owner: &SeededMember,
    project: SharedProjectId,
    seq: u64,
    bytes: &[u8],
) -> PathBuf {
    let relative = format!("snapshots/{project}/{seq}-{}.bin", random_token());
    let path = data_dir.join(&relative);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("legacy folder");
    std::fs::write(&path, bytes).expect("legacy file");
    let size = i64::try_from(bytes.len()).expect("size");
    let account = owner.account_id;
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "INSERT INTO project_snapshots (project_id, seq, file, size, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    project.to_string(),
                    i64::try_from(seq).unwrap_or(0),
                    relative,
                    size,
                    TEST_START_MS,
                    account.to_string()
                ],
            )?;
            Ok(())
        })
        .await
        .expect("a legacy snapshot row");
    path
}

#[tokio::test]
async fn existing_snapshot_files_move_into_the_blob_store_when_the_server_starts() {
    for store in Store::both().await {
        let data = tempfile::tempdir().expect("data folder");
        let mut config = test_config();
        store.configure(&mut config, data.path());
        let first = boot(&config).await;
        let owner = seed_member(&first, ServerRole::Member).await;
        let thesis = project_with_lines(&first, &owner, "Thesis", 3).await;
        let notes = project_with_lines(&first, &owner, "Notes", 0).await;
        let legacy = [
            legacy_snapshot(&first, data.path(), &owner, thesis, 0, b"legacy zero").await,
            legacy_snapshot(&first, data.path(), &owner, thesis, 3, b"legacy three").await,
            legacy_snapshot(&first, data.path(), &owner, notes, 0, b"notes zero").await,
        ];
        drop(first);

        let second = boot(&config).await;
        assert_eq!(
            rows(&second.state, thesis).await,
            vec![(0, hashed(b"legacy zero")), (3, hashed(b"legacy three"))]
        );
        assert_eq!(
            files(&second.state, thesis).await,
            vec![
                snapshot_key(thesis, &sha256_hex(b"legacy zero")),
                snapshot_key(thesis, &sha256_hex(b"legacy three"))
            ]
        );
        for path in &legacy {
            assert!(!path.exists(), "{} is still there", path.display());
        }
        assert!(!data
            .path()
            .join("snapshots")
            .join(thesis.to_string())
            .exists());
        assert_eq!(
            store.holds(data.path(), thesis, &sha256_hex(b"legacy three")),
            Some(b"legacy three".to_vec())
        );
        assert_eq!(
            snapshot_of(&second, &owner, thesis).await,
            (Some(3), b"legacy three".to_vec())
        );
        assert_eq!(
            snapshot_of(&second, &owner, notes).await,
            (Some(0), b"notes zero".to_vec())
        );
        drop(second);

        let third = boot(&config).await;
        assert_eq!(
            rows(&third.state, thesis).await,
            vec![(0, hashed(b"legacy zero")), (3, hashed(b"legacy three"))]
        );
        assert_eq!(store.count(data.path(), thesis), 2);
    }
}

#[tokio::test]
async fn snapshot_files_a_project_no_longer_uses_are_cleared_when_the_server_starts() {
    for store in Store::both().await {
        let data = tempfile::tempdir().expect("data folder");
        let mut config = test_config();
        store.configure(&mut config, data.path());
        let first = boot(&config).await;
        let owner = seed_member(&first, ServerRole::Member).await;
        let project = project_with_lines(&first, &owner, "Thesis", 0).await;
        let waiting = project_with_lines(&first, &owner, "Waiting", 0).await;
        legacy_snapshot(&first, data.path(), &owner, project, 0, b"kept zero").await;
        let held = legacy_snapshot(&first, data.path(), &owner, waiting, 0, b"waiting zero").await;
        let replaced = data
            .path()
            .join("snapshots")
            .join(project.to_string())
            .join("0-replaced.bin");
        let unknown = data
            .path()
            .join("snapshots")
            .join(SharedProjectId::new_v7().to_string())
            .join("4-elsewhere.bin");
        let beside = held.with_file_name("0-replaced.bin");
        for path in [&replaced, &unknown, &beside] {
            std::fs::create_dir_all(path.parent().expect("parent")).expect("folder");
            std::fs::write(path, b"left behind").expect("orphan");
        }
        drop(first);

        if let Store::Bucket(bucket) = &store {
            bucket.set_fault(Some(MockS3Fault::AccessDenied));
        }
        let second = boot(&config).await;
        for path in [&replaced, &beside] {
            assert!(!path.exists(), "{} is still there", path.display());
        }
        assert!(
            unknown.exists(),
            "a folder of a project this server does not know was touched"
        );
        if let Store::Bucket(bucket) = &store {
            assert!(held.exists(), "a file still waiting to move was removed");
            assert_eq!(
                snapshot_of(&second, &owner, waiting).await,
                (Some(0), b"waiting zero".to_vec())
            );
            bucket.set_fault(None);
        }
        drop(second);
        let third = boot(&config).await;
        assert!(!data
            .path()
            .join("snapshots")
            .join(project.to_string())
            .exists());
        assert!(!data
            .path()
            .join("snapshots")
            .join(waiting.to_string())
            .exists());
        assert!(unknown.exists());
        assert_eq!(
            snapshot_of(&third, &owner, waiting).await,
            (Some(0), b"waiting zero".to_vec())
        );
    }
}

#[tokio::test]
async fn an_interrupted_move_resumes_and_loses_nothing() {
    for store in Store::both().await {
        let data = tempfile::tempdir().expect("data folder");
        let mut config = test_config();
        store.configure(&mut config, data.path());
        let first = boot(&config).await;
        let owner = seed_member(&first, ServerRole::Member).await;
        let untouched = project_with_lines(&first, &owner, "Untouched", 0).await;
        let copied = project_with_lines(&first, &owner, "Copied", 0).await;
        let recorded = project_with_lines(&first, &owner, "Recorded", 0).await;
        let legacy = [
            legacy_snapshot(&first, data.path(), &owner, untouched, 0, b"untouched zero").await,
            legacy_snapshot(&first, data.path(), &owner, copied, 0, b"copied zero").await,
            legacy_snapshot(&first, data.path(), &owner, recorded, 0, b"recorded zero").await,
        ];
        first
            .state
            .blobs
            .put_snapshot(copied, axum::body::Bytes::from_static(b"copied zero"))
            .await
            .expect("a copy made before the interruption");
        let hash = first
            .state
            .blobs
            .put_snapshot(recorded, axum::body::Bytes::from_static(b"recorded zero"))
            .await
            .expect("a copy made before the interruption");
        first
            .state
            .db
            .call(move |conn| {
                conn.execute(
                    "UPDATE project_snapshots SET hash = ?2 WHERE project_id = ?1",
                    params![recorded.to_string(), hash],
                )?;
                Ok(())
            })
            .await
            .expect("record the hash before the interruption");
        drop(first);

        if let Store::Bucket(bucket) = &store {
            bucket.set_fault(Some(MockS3Fault::AccessDenied));
            let refused = boot(&config).await;
            for path in &legacy {
                assert!(path.exists(), "{} was removed", path.display());
            }
            assert_eq!(rows(&refused.state, untouched).await, vec![(0, None)]);
            assert_eq!(
                snapshot_of(&refused, &owner, untouched).await,
                (Some(0), b"untouched zero".to_vec())
            );
            assert_eq!(
                snapshot_of(&refused, &owner, recorded).await,
                (Some(0), b"recorded zero".to_vec())
            );
            drop(refused);
            bucket.set_fault(None);
        }

        let resumed = boot(&config).await;
        for (project, bytes) in [
            (untouched, b"untouched zero".as_slice()),
            (copied, b"copied zero"),
            (recorded, b"recorded zero"),
        ] {
            assert_eq!(
                rows(&resumed.state, project).await,
                vec![(0, hashed(bytes))]
            );
            assert_eq!(
                files(&resumed.state, project).await,
                vec![snapshot_key(project, &sha256_hex(bytes))]
            );
            assert_eq!(
                store.holds(data.path(), project, &sha256_hex(bytes)),
                Some(bytes.to_vec())
            );
            assert_eq!(
                snapshot_of(&resumed, &owner, project).await,
                (Some(0), bytes.to_vec())
            );
        }
        for path in &legacy {
            assert!(!path.exists(), "{} is still there", path.display());
        }
    }
}

async fn copy_folder(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("target folder");
    for entry in std::fs::read_dir(from).expect("read folder") {
        let entry = entry.expect("entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("type").is_dir() {
            Box::pin(copy_folder(&entry.path(), &target)).await;
        } else {
            std::fs::copy(entry.path(), target).expect("copy file");
        }
    }
}

fn logged(project: SharedProjectId, owner: &SeededMember, payload: Vec<u8>) -> Vec<u8> {
    let envelope = Envelope {
        v: 1,
        project_id: project,
        batch_id: BatchId::new_v7(),
        device_id: owner.device_id,
        mode: EnvelopeMode::Plain,
        key_epoch: None,
        payload,
        signature: Vec::new(),
    };
    serde_json::to_vec(&envelope).expect("envelope json")
}

#[tokio::test]
async fn a_server_restored_from_its_database_and_blob_store_loses_nothing() {
    for store in Store::both().await {
        let live = tempfile::tempdir().expect("live data folder");
        let mut config = test_config();
        store.configure(&mut config, live.path());
        let node = boot(&config).await;
        node.state.snapshots.set_policy(SNAPSHOT_OFTEN);
        let owner = seed_member(&node, ServerRole::Member).await;
        let mut expected = Vec::new();
        for (title, lines, snapshots) in [
            ("Thesis", 9u64, vec![3u64, 6, 9]),
            ("Paper", 4, vec![2]),
            ("Notes", 0, vec![]),
        ] {
            let project = project_with_lines(&node, &owner, title, 0).await;
            let doc = LoroDoc::new();
            let field = doc.get_text("text");
            field.insert(0, &format!("{title}\n")).expect("title");
            doc.commit();
            let (status, _, _) = fetch(
                &node,
                Method::PUT,
                &format!("/api/v1/projects/{project}/snapshot?seq=0"),
                &owner.access_token,
                doc.export(ExportMode::Snapshot).expect("snapshot"),
            )
            .await;
            assert_eq!(status, StatusCode::NO_CONTENT);
            let device = owner.device_id;
            let account = owner.account_id;
            for line in 1..=lines {
                let before = doc.oplog_vv();
                field
                    .insert(field.len_unicode(), &format!("line {line}\n"))
                    .expect("line");
                doc.commit();
                let stored = logged(
                    project,
                    &owner,
                    doc.export(ExportMode::updates(&before)).expect("update"),
                );
                node.state
                    .db
                    .call(move |conn| {
                        projects::append_update(
                            conn,
                            project,
                            BatchId::new_v7(),
                            device,
                            account,
                            &stored,
                            TEST_START_MS,
                        )
                    })
                    .await
                    .expect("append a line");
                if snapshots.contains(&line) {
                    let (status, seq, _) = fetch(
                        &node,
                        Method::PUT,
                        &format!("/api/v1/projects/{project}/snapshot?seq={line}"),
                        &owner.access_token,
                        Vec::new(),
                    )
                    .await;
                    assert_eq!(status, StatusCode::NO_CONTENT);
                    assert_eq!(seq, Some(line));
                }
            }
            expected.push((project, lines, field.to_string()));
        }
        node.state.run_maintenance().await.expect("maintenance");
        let (thesis, _, _) = &expected[0];
        assert_eq!(oldest_kept(&node.state, *thesis).await, Some(7));

        let restored = tempfile::tempdir().expect("restored data folder");
        let backup = restored.path().join(DATABASE_FILE);
        node.state
            .db
            .call(move |conn| {
                conn.execute("VACUUM INTO ?1", [backup.display().to_string()])?;
                Ok(())
            })
            .await
            .expect("back up the database");
        if let Store::Disk = store {
            copy_folder(&live.path().join("blobs"), &restored.path().join("blobs")).await;
        }
        drop(node);
        drop(live);
        assert!(!restored.path().join("snapshots").exists());

        let mut restored_config = test_config();
        store.configure(&mut restored_config, restored.path());
        let back = boot(&restored_config).await;
        for (project, lines, text) in &expected {
            let (seq, bytes) = snapshot_of(&back, &owner, *project).await;
            let seq = seq.expect("a snapshot seq");
            let project = *project;
            let updates = back
                .state
                .db
                .call(move |conn| projects::updates_since(conn, project, seq))
                .await
                .expect("updates");
            let rebuilt = LoroDoc::new();
            rebuilt.import(&bytes).expect("the snapshot loads");
            for update in &updates {
                let envelope: Envelope =
                    serde_json::from_slice(&update.envelope).expect("an envelope");
                rebuilt.import(&envelope.payload).expect("the change loads");
            }
            assert_eq!(&rebuilt.get_text("text").to_string(), text);
            assert_eq!(updates.last().map_or(seq, |update| update.seq), *lines);
        }
    }
}
