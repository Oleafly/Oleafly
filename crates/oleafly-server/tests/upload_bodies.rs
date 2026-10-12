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
