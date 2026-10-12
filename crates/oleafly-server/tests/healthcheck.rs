mod support;

use std::net::SocketAddr;

use axum::http::StatusCode;
use axum::routing::get;
use axum::Router;
use oleafly_server::healthcheck;
use oleafly_server::test_support::{test_app, test_app_with};

async fn serve_on_loopback(router: Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    address
}

#[tokio::test]
async fn healthcheck_passes_against_a_running_server() {
    let app = test_app().await;
    let address = serve_on_loopback(app.router.clone()).await;
    assert_eq!(healthcheck::check(address).await, Ok(()));
}

#[tokio::test]
async fn healthcheck_uses_the_root_path_when_the_public_url_has_a_prefix() {
    let app = test_app_with(support::config_with(&[(
        "OLEAFLY_PUBLIC_URL",
        "https://uni.edu/oleafly",
    )]))
    .await;
    let address = serve_on_loopback(app.router.clone()).await;
    assert_eq!(healthcheck::check(address).await, Ok(()));
}

#[tokio::test]
async fn healthcheck_fails_on_a_closed_port_and_on_a_non_200_answer() {
    let closed = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    let refused = healthcheck::check(closed).await.unwrap_err();
    assert!(refused.contains("could not connect"), "{refused}");
    let failing = Router::new().route(
        healthcheck::HEALTH_PATH,
        get(|| async { StatusCode::SERVICE_UNAVAILABLE }),
    );
    let address = serve_on_loopback(failing).await;
    let error = healthcheck::check(address).await.unwrap_err();
    assert!(error.contains("503"), "{error}");
}

#[tokio::test]
async fn healthcheck_fails_against_a_server_that_cannot_store_anything() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let data_dir = file.path().join("data").display().to_string();
    let app = test_app_with(support::config_with(&[(
        "OLEAFLY_DATA_DIR",
        data_dir.as_str(),
    )]))
    .await;
    let address = serve_on_loopback(app.router.clone()).await;
    let error = healthcheck::check(address).await.unwrap_err();
    assert!(error.contains("503"), "{error}");
}
