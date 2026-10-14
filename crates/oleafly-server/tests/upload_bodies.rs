use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::http::{header, Method, Request, StatusCode};
use futures_util::stream::{self, StreamExt};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::blobs::sha256_hex;
use oleafly_server::test_support::{seed_member, test_app_with, test_config, TestApp};
use tower::ServiceExt;

const MIB: usize = 1024 * 1024;
const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn counted(chunks: usize, size: usize, polled: Arc<AtomicUsize>) -> Body {
    let chunks = stream::iter(
        (0..chunks).map(move |_| Ok::<_, std::io::Error>(Bytes::from(vec![1u8; size]))),
    )
    .inspect(move |_| {
        polled.fetch_add(1, Ordering::SeqCst);
    });
    Body::from_stream(chunks)
}

async fn small_files_app() -> TestApp {
    let mut config = test_config();
    config.limits.max_file_mb = 1;
    config.limits.max_project_mb = 2;
    test_app_with(config).await
}

async fn create_project(app: &TestApp, token: &str) -> String {
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/projects")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"title":"Thesis"}"#))
        .expect("request");
    let response = app.router.clone().oneshot(request).await.expect("response");
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("body");
    let summary: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    summary["project_id"].as_str().expect("id").to_owned()
}

async fn put_blob(app: &TestApp, token: &str, project: &str, body: Body) -> StatusCode {
    let request = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/v1/projects/{project}/blobs/{HASH}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(body)
        .expect("request");
    app.router
        .clone()
        .oneshot(request)
        .await
        .expect("response")
        .status()
}

#[tokio::test]
async fn a_blob_upload_from_outside_the_project_is_refused_before_its_body_is_read() {
    let app = small_files_app().await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let outsider = seed_member(&app, ServerRole::Member).await;
    let project = create_project(&app, &owner.access_token).await;
    let polled = Arc::new(AtomicUsize::new(0));
    let status = put_blob(
        &app,
        &outsider.access_token,
        &project,
        counted(4, 1024, Arc::clone(&polled)),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(polled.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_blob_upload_stops_reading_once_it_passes_the_file_limit() {
    let app = small_files_app().await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let project = create_project(&app, &owner.access_token).await;
    let polled = Arc::new(AtomicUsize::new(0));
    let status = put_blob(
        &app,
        &owner.access_token,
        &project,
        counted(16, MIB / 2, Arc::clone(&polled)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(polled.load(Ordering::SeqCst) <= 3);
}

#[tokio::test]
async fn a_blob_within_the_file_limit_uploads_even_when_streamed() {
    let app = small_files_app().await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let project = create_project(&app, &owner.access_token).await;
    let content = vec![1u8; 3 * MIB / 4];
    let hash = sha256_hex(&content);
    let request = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/v1/projects/{project}/blobs/{hash}"))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", owner.access_token),
        )
        .body(counted(3, MIB / 4, Arc::new(AtomicUsize::new(0))))
        .expect("request");
    let status = app
        .router
        .clone()
        .oneshot(request)
        .await
        .expect("response")
        .status();
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn a_snapshot_hint_for_a_project_with_a_snapshot_is_answered_without_reading_its_body() {
    let app = small_files_app().await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let project = create_project(&app, &owner.access_token).await;
    let doc = loro::LoroDoc::new();
    doc.get_text("text").insert(0, "first").expect("insert");
    doc.commit();
    let first = doc.export(loro::ExportMode::Snapshot).expect("snapshot");
    let upload = |body: Body| {
        Request::builder()
            .method(Method::PUT)
            .uri(format!("/api/v1/projects/{project}/snapshot?seq=0"))
            .header(
                header::AUTHORIZATION,
                format!("Bearer {}", owner.access_token),
            )
            .body(body)
            .expect("request")
    };
    let stored = app
        .router
        .clone()
        .oneshot(upload(Body::from(first)))
        .await
        .expect("response");
    assert_eq!(stored.status(), StatusCode::NO_CONTENT);
    let polled = Arc::new(AtomicUsize::new(0));
    let hinted = app
        .router
        .clone()
        .oneshot(upload(counted(4, 1024, Arc::clone(&polled))))
        .await
        .expect("response");
    assert_eq!(hinted.status(), StatusCode::NO_CONTENT);
    assert_eq!(polled.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn large_transfers_wait_for_room_in_the_transfer_budget() {
    let app = small_files_app().await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let project = create_project(&app, &owner.access_token).await;
    let content = vec![3u8; MIB];
    let hash = sha256_hex(&content);
    let path = format!("/api/v1/projects/{project}/blobs/{hash}");
    let request = |method: Method, body: Body| {
        Request::builder()
            .method(method)
            .uri(&path)
            .header(
                header::AUTHORIZATION,
                format!("Bearer {}", owner.access_token),
            )
            .body(body)
            .expect("request")
    };
    let stored = app
        .router
        .clone()
        .oneshot(request(Method::PUT, Body::from(content.clone())))
        .await
        .expect("response");
    assert_eq!(stored.status(), StatusCode::NO_CONTENT);
    app.state.transfers.set_budget(MIB as u64);
    let spent = app.state.transfers.hold(MIB as u64).await;
    let mut download = tokio::spawn(
        app.router
            .clone()
            .oneshot(request(Method::GET, Body::empty())),
    );
    let mut upload = tokio::spawn(
        app.router
            .clone()
            .oneshot(request(Method::PUT, Body::from(content.clone()))),
    );
    let waiting = std::time::Duration::from_millis(300);
    assert!(tokio::time::timeout(waiting, &mut download).await.is_err());
    assert!(tokio::time::timeout(waiting, &mut upload).await.is_err());
    drop(spent);
    let downloaded = download.await.expect("task").expect("response");
    assert_eq!(downloaded.status(), StatusCode::OK);
    assert!(tokio::time::timeout(waiting, &mut upload).await.is_err());
    let bytes = axum::body::to_bytes(downloaded.into_body(), 2 * MIB)
        .await
        .expect("the file");
    assert_eq!(bytes.len(), MIB);
    drop(bytes);
    let uploaded = tokio::time::timeout(std::time::Duration::from_secs(5), upload)
        .await
        .expect("the upload gets room once the download is sent")
        .expect("task")
        .expect("response");
    assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
}
