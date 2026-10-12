use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode};
use oleafly_server::build_router;
use oleafly_server::rate_limit::RateLimiter;
use oleafly_server::test_support::test_app;
use serde_json::Value;
use tower::ServiceExt;

fn request(method: Method, path: &str, from: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .body(Body::empty())
        .expect("request");
    let address: SocketAddr = format!("{from}:40000").parse().expect("address");
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

#[tokio::test]
async fn sign_in_endpoints_refuse_a_flood_from_one_address() {
    let mut app = test_app().await;
    app.state.rate_limiter = Arc::new(RateLimiter::new(3, 3));
    let router = build_router(app.state.clone());
    for _ in 0..3 {
        let response = router
            .clone()
            .oneshot(request(Method::POST, "/auth/challenge", "203.0.113.7"))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
    }
    let refused = router
        .clone()
        .oneshot(request(Method::POST, "/auth/challenge", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    let body = axum::body::to_bytes(refused.into_body(), 64 * 1024)
        .await
        .expect("body");
    let error: Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(error["code"], "rate_limited");
    let start = router
        .clone()
        .oneshot(request(Method::GET, "/auth/start", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(start.status(), StatusCode::TOO_MANY_REQUESTS);
    let socket = router
        .clone()
        .oneshot(request(Method::GET, "/ws", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(socket.status(), StatusCode::TOO_MANY_REQUESTS);
    let other = router
        .clone()
        .oneshot(request(Method::POST, "/auth/challenge", "198.51.100.4"))
        .await
        .expect("response");
    assert_eq!(other.status(), StatusCode::OK);
    let health = router
        .clone()
        .oneshot(request(Method::GET, "/healthz", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(health.status(), StatusCode::OK);
    app.clock.advance(60_000);
    let refilled = router
        .clone()
        .oneshot(request(Method::POST, "/auth/challenge", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(refilled.status(), StatusCode::OK);
}
